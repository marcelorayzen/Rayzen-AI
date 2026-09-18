import { execFile, execFileSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, statSync } from 'fs'
import { randomUUID } from 'crypto'
import { join } from 'path'

/**
 * ── A sessão supervisionada rodando na conta `RayzenExec` (Fase 4-B) ────────────────────
 *
 * Até aqui a sessão rodava **como o dono**: mesmo usuário, mesma árvore, mesmas credenciais em
 * disco. A limpeza de `env` e as negações de leitura reduziam superfície, e isso está escrito
 * em `supervised-session.ts` com todas as letras — *não é isolamento*.
 *
 * Isolamento é este módulo: outro usuário do SO, outro perfil, outro checkout, e o trabalho
 * voltando por `git bundle` em vez de aparecer no diretório de quem revisa.
 *
 * ## O que foi medido antes de escrever isto (11/09, `scripts/rayzenexec-9-sondar-sessao.ps1`)
 *
 * | pergunta | resposta |
 * |---|---|
 * | o perfil que a conta recebe é o dela? | sim — `C:\Users\RayzenExec` |
 * | o dono lê o log ENQUANTO a conta escreve? | sim — 10 tamanhos distintos, zero erro de compartilhamento |
 * | o prompt atravessa byte a byte por arquivo? | sim — SHA-256 idêntico, com acento e metacaractere |
 * | o código de saída volta? | sim, por arquivo — `-Wait` dá acesso negado em processo de outra conta |
 * | o marcador do protocolo sobrevive? | sim |
 * | metacaractere no prompt é interpretado? | não — `; && | $(whoami)` voltou literal |
 *
 * Nenhuma dessas era óbvia, e duas quase passaram como verdade sem medição: o `Tee-Object` do
 * PowerShell 5.1 grava UTF-16 e corrompe um log UTF-8 **crescendo normalmente**, e
 * `Start-Process -Credential -Wait` falha DEPOIS de o trabalho ter sido feito.
 *
 * ## Falha fechado
 *
 * Com o modo ligado e a conta indisponível, a sessão **para**. Não existe queda para o usuário
 * do dono: seria desfazer o isolamento exatamente na hora em que ninguém está olhando, e a
 * sessão continuaria reportando sucesso. É a mesma regra do rollback global do plano.
 */

const RAIZ      = process.env.RAYZENEXEC_RAIZ  ?? 'C:\\RayzenExec'
const DROP      = process.env.RAYZENEXEC_DROP  ?? 'C:\\Users\\Public\\rayzen-drop'
const CONTA     = process.env.RAYZENEXEC_CONTA ?? 'RayzenExec'
/** Intervalo de leitura do log da conta. Abaixo disso só se paga E/S sem ganhar nada. */
const TAIL_MS   = 500

export interface ResultadoDaConta {
  /** Saída completa do processo na conta (stdout + stderr, já unidos pelo runner). */
  saida: string
  /** Código de saída do `claude`, recuperado por arquivo. `null` quando não chegou. */
  codigo: number | null
  /** Pares chave=valor que o runner gravou — `claude_ms`, `head`, `bundle`, … */
  campos: Record<string, string>
  /** `git diff --stat HEAD` produzido DENTRO da conta, para o card de aprovação. */
  diff: string
}

export function modoIsoladoLigado(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AGENT_SESSAO_ISOLADA === 'true'
}

export function caminhoDoWorkspace(slug = 'rayzen-ai'): string {
  return join(RAIZ, 'workspaces', slug)
}

/** Onde moram os `.ps1` desta ponte. Resolvido pelo módulo, não pelo cwd — o agent roda de vários. */
export function caminhoDoScript(nome: 'sessao-isolada-lancar' | 'sessao-isolada-runner'): string {
  return join(__dirname, '..', '..', 'scripts', `${nome}.ps1`)
}

/**
 * Tudo o que precisa existir para a sessão rodar na conta.
 *
 * Devolve a LISTA de problemas em vez de um booleano: "a conta não está pronta" não diz qual
 * dos seis pré-requisitos faltou, e quem lê a mensagem é quem vai consertar. Mesmo motivo pelo
 * qual os invariantes carregam `detalhe`.
 */
export function prerequisitos(slug = 'rayzen-ai'): string[] {
  const problemas: string[] = []
  const senha = join(process.env.USERPROFILE ?? '', 'rayzenexec-senha.txt')

  if (process.platform !== 'win32') problemas.push('o modo isolado é específico do Windows (conta local + Start-Process -Credential)')
  if (!existsSync(RAIZ))                        problemas.push(`raiz ausente: ${RAIZ}`)
  if (!existsSync(caminhoDoWorkspace(slug)))    problemas.push(`workspace da conta ausente: ${caminhoDoWorkspace(slug)}`)
  if (!existsSync(senha))                       problemas.push(`senha da conta ausente: ${senha}`)
  if (!existsSync(caminhoDoScript('sessao-isolada-lancar')))  problemas.push('script lançador ausente — rode o build do agent')
  if (!existsSync(caminhoDoScript('sessao-isolada-runner')))  problemas.push('script runner ausente — rode o build do agent')

  return problemas
}

/**
 * Cria o diretório de trabalho no canal público **já fechado**.
 *
 * A ordem é o ponto. `C:\Users\Public` é legível por qualquer conta local por padrão, e o que
 * passa por aqui inclui o prompt da sessão e um bundle de 21 MB com o repositório privado
 * inteiro. Restringir depois de escrever deixa uma janela aberta — e esta casa já pagou por
 * inverter exatamente essa ordem: em 09/09 o `icacls /reset` precisou vir **antes** do
 * `proteger-segredos-locais.ps1`, senão o relatório saía "OK" com os segredos reabertos.
 *
 * `execFileSync`, nunca pelo Bash: o Git Bash converte `/inheritance:r` em caminho MSYS e o
 * `icacls` sai com **código 0 sem fazer nada** (medido em 09/09).
 */
function novoTrabalho(sessionId: string, etapa: string): string {
  const dir = join(DROP, `sessao-${sessionId.slice(0, 8)}-${etapa}-${Date.now()}`)
  mkdirSync(dir, { recursive: true })

  if (process.platform === 'win32') {
    const usuario = process.env.USERNAME ?? ''
    try {
      execFileSync('icacls', [dir, '/inheritance:r'], { stdio: 'ignore' })
      execFileSync('icacls', [dir, '/grant:r',
        // Grupos internos por SID, nunca por nome: `Administradores` se chama outra coisa em
        // cada idioma do Windows. E eles PRECISAM entrar — em 09/09 um `/inheritance:r` que
        // esqueceu `Administradores` deixou a árvore não-administrável até para o rollback.
        '*S-1-5-18:(OI)(CI)F',        // SYSTEM
        '*S-1-5-32-544:(OI)(CI)F',    // Administradores
        `${usuario}:(OI)(CI)F`,
        `${CONTA}:(OI)(CI)RX`,        // a conta LÊ o que vai executar; não escreve no canal
      ], { stdio: 'ignore' })
    } catch (err) {
      // Falha FECHADO: sem a ACL, o próximo passo escreveria o repositório privado num
      // diretório que qualquer conta local lê. Melhor não ter sessão que ter vazamento.
      rmSync(dir, { recursive: true, force: true })
      throw new Error(`Não consegui restringir o canal ${dir}: ${(err as Error).message}`)
    }
  }
  return dir
}

/**
 * Lê o que apareceu no log desde a última leitura.
 *
 * Não usa `fs.watch`: o arquivo é escrito por OUTRO usuário, em outra sessão de logon, e a
 * notificação de mudança entre contas não é algo que se deva presumir. Pesquisa por tamanho é
 * grosseira e funciona — foi exatamente assim que a sonda mediu o crescimento ao vivo.
 */
export function lerDesde(caminho: string, deslocamento: number): { texto: string; fim: number } {
  try {
    const tamanho = statSync(caminho).size
    if (tamanho <= deslocamento) return { texto: '', fim: deslocamento }
    // Lê o arquivo inteiro e corta: o log de uma sessão é de kilobytes, e `readFileSync` usa
    // modo de compartilhamento que convive com o escritor (medido).
    const bruto = readFileSync(caminho)
    const texto = bruto.subarray(deslocamento, tamanho).toString('utf8')
    return { texto, fim: tamanho }
  } catch {
    return { texto: '', fim: deslocamento }
  }
}

function lerCampos(caminho: string): Record<string, string> {
  const campos: Record<string, string> = {}
  try {
    for (const linha of readFileSync(caminho, 'utf8').split(/\r?\n/)) {
      // `[a-z0-9_]`, com dígito: a primeira versão desta leitura usava `[a-z_]` e engolia
      // `prompt_sha256` calada — o valor chegava, a chave é que não casava.
      const m = linha.replace(/^\uFEFF/, '').match(/^([a-z0-9_]+)=(.*)$/)
      if (m) campos[m[1]] = m[2]
    }
  } catch { /* sem arquivo de resultado — quem decide é o chamador */ }
  return campos
}

/**
 * Roda um verbo do runner dentro da conta e devolve o que ele produziu.
 *
 * `execFile`, nunca `exec`: o argv leva caminhos e nomes de verbo, e nada dele passa por shell.
 * O conteúdo da sessão já está em arquivo quando esta função é chamada.
 */
function rodarNaConta(
  acao: 'preparar' | 'executar' | 'entregar',
  trabalho: string,
  slug: string,
  aoReceberLog?: (chunk: string) => void,
  timeoutMin = 45,
): Promise<ResultadoDaConta> {
  const marca = randomUUID()
  const carimbo = `${acao}-${Date.now()}`
  const log   = join(RAIZ, 'logs', `sessao-${carimbo}.log`)
  const res   = join(RAIZ, 'logs', `sessao-${carimbo}.res`)
  const feito = join(RAIZ, 'logs', `sessao-${carimbo}.done`)

  return new Promise((resolver, rejeitar) => {
    const filho = execFile('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', caminhoDoScript('sessao-isolada-lancar'),
      '-Acao', acao,
      '-Trabalho', trabalho,
      '-Workspace', caminhoDoWorkspace(slug),
      '-Log', log, '-Res', res, '-Feito', feito, '-Marca', marca,
      '-Conta', CONTA,
      '-TimeoutMin', String(timeoutMin),
    ], { windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: (timeoutMin + 2) * 60_000 })

    let deslocamento = 0
    let acumulado = ''
    const bombear = () => {
      const { texto, fim } = lerDesde(log, deslocamento)
      deslocamento = fim
      if (texto) {
        acumulado += texto
        aoReceberLog?.(texto)
      }
    }
    const relogio = setInterval(bombear, TAIL_MS)

    filho.on('close', (codigoDoLancador) => {
      clearInterval(relogio)
      bombear() // leitura final: o que a conta escreveu entre o último tique e o fim

      const campos = lerCampos(res)
      const codigo = campos.claude_exit !== undefined ? Number(campos.claude_exit) : null
      let diff = ''
      try { diff = readFileSync(`${res}.diff`, 'utf8').replace(/^﻿/, '').trim() } catch { /* sem diff */ }

      if (codigoDoLancador !== 0 && campos.fim !== 'ok') {
        rejeitar(new Error(
          `A conta ${CONTA} não concluiu a etapa "${acao}" (lançador saiu ${codigoDoLancador}). ` +
          `Log em ${log}`,
        ))
        return
      }
      resolver({ saida: acumulado, codigo, campos, diff })
    })

    filho.on('error', (err) => {
      clearInterval(relogio)
      rejeitar(err)
    })
  })
}

/**
 * Põe a árvore da conta no mesmo commit em que o dono está.
 *
 * Sem isto a sessão trabalharia sobre o código do dia em que o clone foi criado. Medido em
 * 11/09: o clone da conta estava **nove commits atrás** do `main` do dono, de 08/09. O patch
 * sairia contra um passado, e o `bundle verify` só acusaria no fim, com o trabalho pronto.
 *
 * Devolve o SHA que passa a ser a base — é contra ele que a entrega será incremental.
 */
export async function prepararWorkspace(
  sessionId: string,
  repoDoDono: string,
  slug = 'rayzen-ai',
): Promise<{ base: string; ramo: string }> {
  const base = execFileSync('git', ['-C', repoDoDono, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const ramo = `rayzen/sessao-${sessionId.slice(0, 8)}`
  const trabalho = novoTrabalho(sessionId, 'preparar')

  // `git bundle` carrega SOMENTE objetos versionados. `.env`, chave e `hook.config.mjs` são
  // gitignored e não rastreados — não existe caminho para eles entrarem. É por isso que o
  // workspace da conta é semeado assim, e não por cópia de diretório.
  execFileSync('git', ['-C', repoDoDono, 'bundle', 'create', join(trabalho, 'base.bundle'), 'main'], {
    stdio: 'ignore',
  })
  writeFileSync(join(trabalho, 'ramo.txt'), ramo, 'utf8')

  const r = await rodarNaConta('preparar', trabalho, slug, undefined, 10)
  if (r.campos.checkout_exit !== '0') {
    throw new Error(`A conta não conseguiu preparar o workspace no ramo ${ramo}: ${JSON.stringify(r.campos)}`)
  }
  return { base, ramo }
}

/** Uma iteração do laço supervisionado, executada dentro da conta. */
export async function executarNaConta(
  sessionId: string,
  prompt: string,
  ferramentasPermitidas: readonly string[],
  ferramentasNegadas: readonly string[],
  aoReceberLog?: (chunk: string) => void,
  slug = 'rayzen-ai',
): Promise<ResultadoDaConta> {
  const trabalho = novoTrabalho(sessionId, 'executar')
  // Os três entram como DADO. O prompt é texto de terceiro por definição; as listas de
  // ferramentas continuam tendo o TypeScript como fonte única, em vez de uma cópia no `.ps1`
  // — duas listas divergindo é como um valida contra uma coisa e o outro roda contra outra.
  writeFileSync(join(trabalho, 'prompt.txt'),     prompt,                             'utf8')
  writeFileSync(join(trabalho, 'permitidas.txt'), ferramentasPermitidas.join('\r\n'), 'utf8')
  writeFileSync(join(trabalho, 'negadas.txt'),    ferramentasNegadas.join('\r\n'),    'utf8')

  return rodarNaConta('executar', trabalho, slug, aoReceberLog)
}

/**
 * A conta empacota o que produziu e deixa no `outbox`, de onde o dono lê.
 *
 * Nunca um merge, nunca um remoto compartilhado: o dono não roda git dentro da árvore da conta
 * — o próprio git recusa com *dubious ownership*, e com razão, porque um `.git/config` escrito
 * lá seria executado com a identidade de quem rodasse o comando.
 */
export async function entregarTrabalho(
  sessionId: string,
  base: string,
  slug = 'rayzen-ai',
): Promise<{ bundle: string | null; commits: number }> {
  const trabalho = novoTrabalho(sessionId, 'entregar')
  // `slice(0, 14)`, não 15: a 15ª posição de `20260911143326.789Z` é o ponto dos
  // milissegundos, e o nome saía `rayzen-ai-20260911143326..bundle`.
  const carimbo = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const destino = join(RAIZ, 'outbox', `${slug}-${carimbo}.bundle`)

  writeFileSync(join(trabalho, 'base.txt'),   base,    'utf8')
  writeFileSync(join(trabalho, 'bundle.txt'), destino, 'utf8')

  const r = await rodarNaConta('entregar', trabalho, slug, undefined, 10)
  const commits = Number(r.campos.commits ?? '0')
  return { bundle: r.campos.bundle ? r.campos.bundle : null, commits }
}

/**
 * O que o dono faz com o trabalho quando a sessão termina.
 *
 * Vai junto do resumo de conclusão pelo mesmo motivo das instruções de merge do modo local: um
 * bundle que ninguém sabe que existe é igual a trabalho perdido. A diferença é o contrato —
 * aqui o trabalho chega como **ref isolada**, endereçável e descartável, e a árvore de quem
 * revisa não se move.
 */
export function instrucoesDeBundle(bundle: string | null, commits: number, base: string): string {
  if (!bundle || commits === 0) {
    return [
      '',
      '---',
      `A sessão rodou na conta \`${CONTA}\`, em \`${caminhoDoWorkspace()}\`, e **não produziu commit**.`,
      'Nada a trazer. Seu diretório de trabalho não foi tocado em momento nenhum.',
    ].join('\n')
  }

  const ref = `refs/rayzenexec/${bundle.replace(/^.*[\\/]/, '').replace(/\.bundle$/, '')}`
  return [
    '',
    '---',
    `Trabalho feito pela conta \`${CONTA}\`, fora do seu perfil, e entregue como bundle:`,
    `\`${bundle}\` — ${commits} commit(s) sobre \`${base.slice(0, 7)}\`.`,
    '',
    'Nada foi escrito no seu diretório de trabalho, e nada foi mesclado. Para revisar:',
    '',
    '```bash',
    `git bundle verify "${bundle}"              # os pré-requisitos existem no seu repo?`,
    `git fetch "${bundle}" HEAD:${ref}`,
    `git log --oneline ${base.slice(0, 7)}..${ref}`,
    `git diff ${base.slice(0, 7)}..${ref}`,
    '```',
    '',
    `Para descartar: \`git update-ref -d ${ref}\``,
  ].join('\n')
}

/** Remove diretórios de trabalho esquecidos no canal público. Best-effort, nunca lança. */
export function limparCanal(): void {
  try {
    rmSync(DROP, { recursive: true, force: true })
  } catch { /* o canal é conveniência; falhar ao limpar não derruba sessão */ }
}
