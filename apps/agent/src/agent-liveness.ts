import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Rastro local de "o agent desktop está de pé", lido pelo `rayzen-context-hook`.
 *
 * Existe porque a ausência do agent era **completamente silenciosa**. Em 2026-09-06
 * o `guardian` ficou 28h sem bater — o PC reiniciou e ninguém religou o agent — e
 * nada disse nada: os hooks do Claude Code continuam funcionando (rodam do `src`,
 * não dependem do agent), o painel continua verde, e o contexto injetado segue com
 * a mesma cara. O que para é o workspace-watcher, o Guardian e o disparo de
 * invariantes: exatamente a vigilância que existe para avisar quando algo para.
 *
 * ## Por que arquivo local, e não o `system_heartbeats` do servidor
 *
 * O servidor já sabe — `beatGuardian` bate a cada 5 min e `GET /v2/system/status`
 * mostra `sem-noticia`. Só que o hook roda com orçamento de ~2,5s e já gasta três
 * chamadas HTTP; uma quarta para perguntar algo que a máquina local sabe de graça
 * seria pagar latência por informação de segunda mão.
 *
 * E as duas perguntas não são a mesma. O batimento responde *"o agent deu notícia
 * recentemente?"*, do ponto de vista do servidor — que não distingue agent parado
 * de rede caída. Este arquivo responde *"o agent está rodando NESTA máquina, agora"*,
 * que é a pergunta de quem está sentado nela.
 *
 * `writeFileSync` a cada tick (30s) é ~0,1ms e não pode falhar de forma que derrube
 * o watcher: quem observa não morre por causa da contabilidade de que observa.
 */

export const ARQUIVO_VIVO = join(tmpdir(), 'rayzen-agent-vivo.json')

export function marcarVivo(): void {
  try {
    writeFileSync(
      ARQUIVO_VIVO,
      JSON.stringify({ em: Date.now(), pid: process.pid, host: process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? null }),
      'utf8',
    )
  } catch {
    /* tmpdir cheio ou sem permissão — o silêncio vira o próprio sinal no hook */
  }
}
