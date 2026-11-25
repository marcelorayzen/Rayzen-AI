import { isAbsolute, normalize } from 'path'
import { ehSegredo } from './arquivos-do-projeto'

/**
 * Template `padrao-rayzen` do `create_project_folder` — item 7.6 (12/11).
 *
 * ── O conteúdo aprovado é o que vai para o disco ─────────────────────────────
 * O template `rayzen` gera a especificação com um LLM DENTRO do agent a partir de um brief curto
 * (`generateSpecFromBrief`) — o tipo de geração que esta casa já viu inventar decisão. Aqui não
 * se gera nada: os arquivos chegam prontos no payload, produzidos pela descoberta com a pessoa
 * (skill `rayzen-project-architect`), e o payload entra no hash que a aprovação do envelope
 * assina. O que foi aprovado é, byte a byte, o que é escrito.
 *
 * ── Validado na prévia E na execução ─────────────────────────────────────────
 * Caminho inválido recusa já no `dryRun`, então um plano malformado nunca chega a aprovação
 * com cara de executável.
 */

export interface ArquivoDoPlano {
  path: string
  conteudo: string
}

const MAX_ARQUIVOS = 80
const MAX_BYTES_ARQUIVO = 200 * 1024
const MAX_BYTES_TOTAL = 2 * 1024 * 1024

/** Linhas que todo projeto no padrão ignora — o privado nunca entra no commit inicial. */
export const IGNORADOS_DO_PADRAO = ['.local/', 'CLAUDE.local.md', '.env', '.env.*', '!.env.example', 'node_modules/', 'dist/']

/** Normaliza e valida; lança com a lista de problemas (todos de uma vez, não o primeiro). */
export function validarArquivosDoPlano(arquivos: unknown): ArquivoDoPlano[] {
  if (!Array.isArray(arquivos) || arquivos.length === 0) {
    throw new Error('padrao-rayzen exige "arquivos" — o conteúdo aprovado do plano; nada é gerado no agent')
  }
  if (arquivos.length > MAX_ARQUIVOS) throw new Error(`plano com ${arquivos.length} arquivos (máximo ${MAX_ARQUIVOS})`)

  const problemas: string[] = []
  const vistos = new Set<string>()
  let total = 0
  const saida: ArquivoDoPlano[] = []

  for (const [i, a] of arquivos.entries()) {
    const bruto = (a as { path?: unknown })?.path
    const conteudo = (a as { conteudo?: unknown })?.conteudo
    if (typeof bruto !== 'string' || typeof conteudo !== 'string') {
      problemas.push(`#${i}: path e conteudo precisam ser texto`)
      continue
    }
    const p = normalize(bruto.trim().replace(/\\/g, '/')).replace(/\\/g, '/').replace(/^\.\//, '')
    if (!p || p === '.' || isAbsolute(p) || /^[a-z]:/i.test(p) || p.split('/').includes('..')) {
      problemas.push(`${bruto}: caminho precisa ser relativo e dentro do projeto`)
      continue
    }
    if (p === '.git' || p.startsWith('.git/')) { problemas.push(`${p}: .git é do git, não do plano`); continue }
    if (ehSegredo(p)) { problemas.push(`${p}: arquivo de segredo não entra no plano (use .env.example só com nomes)`); continue }
    if (p === '.mcp.json' || p.startsWith('.claude/')) {
      problemas.push(`${p}: a integração com o Rayzen é escrita pelo gerador (sem token), não pelo plano`)
      continue
    }
    const chave = p.toLowerCase()
    if (vistos.has(chave)) { problemas.push(`${p}: repetido no plano`); continue }
    vistos.add(chave)
    const bytes = Buffer.byteLength(conteudo, 'utf8')
    if (bytes > MAX_BYTES_ARQUIVO) { problemas.push(`${p}: ${bytes} bytes (máximo ${MAX_BYTES_ARQUIVO})`); continue }
    total += bytes
    saida.push({ path: p, conteudo })
  }
  if (total > MAX_BYTES_TOTAL) problemas.push(`plano com ${total} bytes no total (máximo ${MAX_BYTES_TOTAL})`)
  if (!saida.some((a) => a.path === 'AGENTS.md')) problemas.push('AGENTS.md é obrigatório no padrão Rayzen (contrato de trabalho)')
  if (problemas.length) throw new Error(`plano recusado: ${problemas.join('; ')}`)
  return saida
}

/**
 * G4.2 (20/11): `CLAUDE.md` e `CLAUDE.local.md` que o gerador acrescenta quando o plano não os
 * traz. O Claude Code carrega `CLAUDE.md` sozinho, mas não o `AGENTS.md`: medido em 20/11, só 2 de 4
 * sessões da sandbox leram o contrato por conta própria. O import `@AGENTS.md` faz o contrato chegar
 * a qualquer ferramenta que abrir o repositório. O `.local` é o padrão do Marcelo em todo projeto e
 * já está em `IGNORADOS_DO_PADRAO`, então nunca entra no commit inicial. Plano que traz o próprio
 * arquivo vence: nada aqui sobrescreve o que a pessoa aprovou.
 */
export function arquivosGeradosDoPadrao(plano: ArquivoDoPlano[]): ArquivoDoPlano[] {
  const tem = (p: string) => plano.some((a) => a.path.toLowerCase() === p.toLowerCase())
  const extras: ArquivoDoPlano[] = []
  if (!tem('CLAUDE.md')) {
    const imports = ['@AGENTS.md', ...(tem('PRODUCT.md') ? ['@PRODUCT.md'] : [])]
    extras.push({
      path: 'CLAUDE.md',
      conteudo: [
        '# CLAUDE.md',
        '',
        ...imports,
        '',
        '> Gerado pelo padrão Rayzen. O contrato de trabalho deste projeto é o `AGENTS.md`, importado',
        '> acima; não repita aqui o que já está lá. Notas pessoais e desta máquina ficam no',
        '> `CLAUDE.local.md`, fora do git.',
        '',
      ].join('\n'),
    })
  }
  if (!tem('CLAUDE.local.md')) {
    extras.push({
      path: 'CLAUDE.local.md',
      conteudo: [
        '# CLAUDE.local.md — notas locais',
        '',
        'Preferências pessoais, caminhos desta máquina e lembretes que não pertencem ao repositório.',
        'Este arquivo está no `.gitignore` do padrão Rayzen e nunca é commitado.',
        '',
      ].join('\n'),
    })
  }
  return extras
}

/** `.gitignore` do plano com as linhas do padrão garantidas (sem duplicar as que já estão). */
export function gitignoreDoPadrao(doPlano?: string): string {
  const base = (doPlano ?? '').replace(/\r\n/g, '\n').trimEnd()
  const existentes = new Set(base.split('\n').map((l) => l.trim()))
  const faltando = IGNORADOS_DO_PADRAO.filter((l) => !existentes.has(l))
  if (!faltando.length) return `${base}\n`
  const bloco = `# padrão Rayzen — privado e gerado ficam fora do git\n${faltando.join('\n')}\n`
  return base ? `${base}\n\n${bloco}` : bloco
}
