import axios from 'axios'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'

/**
 * Cliente dos invariantes do sistema.
 *
 * Mesma arquitetura do guardian-client: a api-v2 escreve no tmpdir do container
 * Docker, inacessível ao hook — então quem grava o cache que o
 * rayzen-context-hook lê é o agent, aqui.
 *
 * A diferença é a cadência. O Guardian responde "o que você acabou de mudar",
 * então faz sentido rodar a cada save. Invariante é estado de sistema: não muda
 * porque um arquivo foi salvo, e o check de relógio ainda faz uma chamada HTTP
 * externa. Por isso o throttle — sem ele, editar um arquivo dispararia uma
 * varredura completa a cada 30 segundos.
 */

export interface InvariantResult {
  id:        string
  titulo:    string
  categoria: 'infra' | 'dado' | 'config'
  gravidade: 'alta' | 'media' | 'baixa'
  ok:        boolean
  detalhe:   string
  correcao?: string
}

export interface InvariantReport {
  projectId:    string
  totalOk:      number
  totalFalha:   number
  gravidadeMax: 'alta' | 'media' | 'baixa' | 'ok'
  resumo:       string
  resultados:   InvariantResult[]
}

const CACHE_TTL_MS  = 30 * 60 * 1000   // o hook considera o cache válido por 30min
const MIN_INTERVALO = 15 * 60 * 1000   // não roda de novo antes disso

function cachePath(projectId: string): string {
  const hash = createHash('sha256').update(projectId).digest('hex').slice(0, 8)
  return join(tmpdir(), `rayzen-invariants-${hash}.json`)
}

/** Última execução ainda dentro da janela de throttle? */
function rodouRecentemente(projectId: string): boolean {
  try {
    const file = cachePath(projectId)
    if (!existsSync(file)) return false
    const { rodadoEm } = JSON.parse(readFileSync(file, 'utf8')) as { rodadoEm?: number }
    return typeof rodadoEm === 'number' && Date.now() - rodadoEm < MIN_INTERVALO
  } catch { return false }
}

export async function triggerInvariantsCheck(params: {
  projectId: string
  apiV2Url:  string
  apiToken:  string
  /** Ignora o throttle — usado por execução manual. */
  forcar?:   boolean
}): Promise<InvariantReport | null> {
  if (!params.forcar && rodouRecentemente(params.projectId)) return null

  try {
    const { data } = await axios.post<InvariantReport>(
      `${params.apiV2Url}/v2/invariants/run/${params.projectId}`,
      {},
      { headers: { Authorization: `Bearer ${params.apiToken}` }, timeout: 20_000 },
    )

    writeFileSync(
      cachePath(params.projectId),
      JSON.stringify({ report: data, rodadoEm: Date.now(), expiresAt: Date.now() + CACHE_TTL_MS }),
    )
    return data
  } catch (err) {
    // Não relançar — invariante nunca bloqueia o watcher. Mas deixar rastro: um
    // check que nunca roda é exatamente o tipo de silêncio que ele existe para evitar.
    const status = axios.isAxiosError(err) ? err.response?.status : undefined
    const detail = axios.isAxiosError(err) && err.response?.data
      ? JSON.stringify(err.response.data).slice(0, 200)
      : err instanceof Error ? err.message : String(err)
    console.warn(`[invariants] run falhou${status ? ` (HTTP ${status})` : ''}: ${detail}`)
    return null
  }
}
