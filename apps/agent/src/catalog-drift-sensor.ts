import axios from 'axios'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { executarPrograma, ambientePadrao } from './exec/executar-programa'
import { beatComponente } from './system-heartbeat-client'

/**
 * S2 (15/11) — o primeiro sinal que vira PROPOSTA, em vez de só alerta.
 *
 * O sinal: `docs/agent-actions.md` divergiu do código (whitelist + registro da V2). A proposta:
 * um envelope de sessão de código no projeto do próprio repositório, pedindo para regenerar e
 * commitar só aquele arquivo — que cai no fio do Hub como card de um toque, para no diff final
 * e só vira PR depois de o Marcelo aprovar o diff.
 *
 * ── Por que este sinal, e não o disco ───────────────────────────────────────
 * `disco_com_folga` era o outro candidato do backlog, mas não há envelope que o corrija: podar
 * o Docker do servidor não é ação do agent, e não deveria ser. Documentação desatualizada se
 * corrige com uma sessão de código — o caminho que já existe de ponta a ponta. Começar pelo
 * sinal cuja correção cabe no envelope prova o caminho sem inventar efeito novo.
 *
 * ── Por que no agent-server ──────────────────────────────────────────────────
 * Mesma razão do `deploy-drift`: é o único processo do servidor com o repositório montado
 * (só leitura) e o `AGENT_TOKEN`. O gerador roda com `--stdout`, então nada é gravado no mount.
 *
 * ── O que ele NÃO faz ───────────────────────────────────────────────────────
 * Não aprova, não materializa, não corrige. Cria e ENVIA o envelope; a alçada decide o resto
 * (sessão de código = um toque). E não empilha: com um envelope do mesmo sinal ainda aberto,
 * só registra — repetir a proposta a cada ciclo é o modo pelo qual um aviso deixa de ser lido.
 */

const TICK_MS = 6 * 60 * 60 * 1000
const ESPERA_INICIAL_MS = 3 * 60 * 1000

/** Nome fixo: é por ele que o sensor reconhece uma proposta sua ainda aberta. */
export const NOME_DA_PROPOSTA = 'Atualizar docs/agent-actions.md — catálogo divergiu do código'

const ESTADOS_ABERTOS = new Set(['draft', 'awaiting_approval', 'approved', 'queued', 'claimed', 'executing', 'reconciling', 'effect_unknown'])

/** A data de geração muda a cada execução e não é conteúdo — compará-la daria deriva eterna. */
export function normalizarCatalogo(texto: string): string[] {
  return texto.replace(/\r\n/g, '\n').split('\n')
    .filter((l) => !l.startsWith('> Gerado em:'))
    .map((l) => l.trimEnd())
    .join('\n').trim().split('\n')
}

/** Linhas que só existem de um lado — o resumo que vai no brief, não um diff de verdade. */
export function compararCatalogo(gerado: string, versionado: string): { divergiu: boolean; faltam: string[]; sobram: string[] } {
  const g = normalizarCatalogo(gerado)
  const v = normalizarCatalogo(versionado)
  const setG = new Set(g)
  const setV = new Set(v)
  const faltam = g.filter((l) => !setV.has(l))
  const sobram = v.filter((l) => !setG.has(l))
  return { divergiu: g.join('\n') !== v.join('\n'), faltam, sobram }
}

/** `git@host:dono/repo.git` ou `https://host/dono/repo(.git)` → `repo`. Sem remoto, `null`. */
export function slugDoRemoto(gitConfig: string): string | null {
  const bloco = gitConfig.split(/\r?\n(?=\[)/).find((b) => /^\[remote "origin"\]/.test(b))
  const url = bloco?.match(/^\s*url\s*=\s*(.+)$/m)?.[1]?.trim()
  if (!url) return null
  const m = url.match(/[/:]([^/:]+?)(?:\.git)?\/?$/)
  return m ? m[1] : null
}

export function montarPrompt(faltam: string[], sobram: string[]): string {
  const amostra = (ls: string[]) => ls.slice(0, 8).map((l) => `  ${l}`).join('\n') || '  (nenhuma)'
  return [
    'O catálogo de ações (`docs/agent-actions.md`) divergiu do código — detectado pelo sensor de deriva do servidor.',
    '',
    'Faça só isto:',
    '1. Rode `pnpm gen:catalog`.',
    '2. Confira com `git status` que SÓ `docs/agent-actions.md` mudou. Se outro arquivo mudar, pare e relate.',
    '3. Commite com a mensagem `docs(agent): regenerate action catalog`.',
    '',
    'Não edite o catálogo à mão e não altere nenhum outro arquivo. Se a divergência parecer vir de',
    'uma ação sem metadata ou de metadata órfã, relate no resumo em vez de corrigir o código.',
    '',
    'Linhas que o código gera e o arquivo não tem:',
    amostra(faltam),
    'Linhas que o arquivo tem e o código não gera mais:',
    amostra(sobram),
  ].join('\n')
}

interface Dependencias {
  gerar: (raiz: string) => Promise<string>
  ler: (caminho: string) => string
  api: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body?: unknown) => Promise<T> }
}

function api() {
  const cliente = axios.create({
    baseURL: process.env.AGENT_API_URL,
    headers: { Authorization: `Bearer ${process.env.AGENT_TOKEN}` },
    timeout: 45_000,
  })
  return {
    get: async <T>(url: string) => (await cliente.get<T>(url)).data,
    post: async <T>(url: string, body?: unknown) => (await cliente.post<T>(url, body ?? {})).data,
  }
}

async function gerarPeloScript(raiz: string): Promise<string> {
  const r = await executarPrograma('executavel', 'node', [join(raiz, 'scripts', 'gen-agent-catalog.mjs'), '--stdout'], {
    cwd: raiz, env: ambientePadrao(), timeoutMs: 30_000,
  })
  if (r.code !== 0 || r.timedOut) throw new Error(`gerador do catálogo falhou (código ${r.code}): ${r.stderr.slice(0, 200)}`)
  return r.stdout
}

export type ResultadoDaRodada =
  | { estado: 'em-dia' }
  | { estado: 'proposta-aberta'; handoffId: string }
  | { estado: 'proposto'; handoffId: string; alcada?: string }

/** Uma rodada: mede, e se divergiu, propõe — ou reconhece a proposta já aberta. */
export async function rodarUmaVez(
  raiz = process.env.AGENT_PROJECT_ROOT ?? '',
  deps: Dependencias = { gerar: gerarPeloScript, ler: (c) => readFileSync(c, 'utf8'), api: api() },
): Promise<ResultadoDaRodada> {
  const gerado = await deps.gerar(raiz)
  const versionado = deps.ler(join(raiz, 'docs', 'agent-actions.md'))
  const { divergiu, faltam, sobram } = compararCatalogo(gerado, versionado)
  if (!divergiu) return { estado: 'em-dia' }

  const slug = slugDoRemoto(deps.ler(join(raiz, '.git', 'config')))
  if (!slug) throw new Error('o repositório montado não tem remoto origin — não sei de qual projeto propor')
  const projetos = await deps.api.get<{ id: string }[]>(`/projects?repoSlug=${encodeURIComponent(slug)}`)
  const projeto = projetos[0]
  if (!projeto) throw new Error(`nenhum projeto com repoSlug "${slug}" — a proposta não teria dono`)

  const abertos = await deps.api.get<{ id: string; name: string; status: string; sourceProjectId: string | null }[]>('/handoffs')
  const jaAberto = abertos.find((h) => h.name === NOME_DA_PROPOSTA && h.sourceProjectId === projeto.id && ESTADOS_ABERTOS.has(h.status))
  if (jaAberto) return { estado: 'proposta-aberta', handoffId: jaAberto.id }

  const envelope = await deps.api.post<{ id: string }>('/handoffs', {
    sourceProjectId: projeto.id,
    name: NOME_DA_PROPOSTA,
    brief: `Sinal do servidor: o catálogo de ações divergiu do código (${faltam.length} linha(s) novas, ${sobram.length} a remover). `
      + 'Proposta: uma sessão regenera e commita só esse arquivo; para no diff final antes do PR.',
    template: 'sessao',
    root: process.env.AGENT_PROPOSTA_ROOT ?? 'C:/Users/dev/Projects',
    efeitos: [{
      actionKey: 'jarvis:supervised_session',
      payload: { projectId: projeto.id, prompt: montarPrompt(faltam, sobram), publicar: true, aprovacao: 'por_entrega' },
    }],
    principal: 'sinal:catalog-drift',
  })
  const enviado = await deps.api.post<{ alcada?: string }>(`/handoffs/${envelope.id}/submit`)
  return { estado: 'proposto', handoffId: envelope.id, alcada: enviado?.alcada }
}

async function cicloComBatimento(): Promise<void> {
  let ok = false
  let erro: string | undefined
  let detalhe: Record<string, unknown> = {}
  try {
    const r = await rodarUmaVez()
    detalhe = { ...r }
    ok = true
    if (r.estado === 'proposto') console.log(`[catalog-drift] catálogo divergiu — proposta ${r.handoffId} enviada (alçada ${r.alcada})`)
  } catch (e) {
    erro = e instanceof Error ? e.message : String(e)
    console.warn(`[catalog-drift] ${erro}`)
  } finally {
    // `finally`: ciclo que lança antes de bater fica idêntico a um que nunca subiu.
    await beatComponente('catalog-drift', { ok, erro, detalhe })
  }
}

/** Só no agent-server, com o repositório montado — no desktop bateria "inconclusivo" para sempre. */
export function startCatalogDriftSensor(): void {
  if (process.env.AGENT_ROLE !== 'server') return
  if (process.env.AGENT_CATALOG_DRIFT_ENABLED === 'false') return
  const raiz = process.env.AGENT_PROJECT_ROOT ?? ''
  if (!raiz || !existsSync(join(raiz, 'scripts', 'gen-agent-catalog.mjs'))) {
    console.log('[catalog-drift] repositório sem o gerador do catálogo — sensor não sobe')
    return
  }
  console.log('[catalog-drift] sensor ativo — catálogo de ações vs código a cada 6 h')
  setTimeout(() => {
    void cicloComBatimento()
    setInterval(() => { void cicloComBatimento() }, TICK_MS)
  }, ESPERA_INICIAL_MS)
}
