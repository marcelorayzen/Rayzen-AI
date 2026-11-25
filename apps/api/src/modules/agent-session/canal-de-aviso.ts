import { Injectable } from '@nestjs/common'
import { TelegramService } from '../telegram/telegram.service'

/**
 * G7.2 — por onde os avisos da sessão supervisionada saem.
 *
 * O `AgentSessionService` depende só disto, não do Telegram: trocar de canal (WhatsApp, depois) é
 * registrar outra implementação no módulo, sem tocar no service. Uma frase de texto é o contrato
 * inteiro de propósito — o canal decide como formatar e para quem entregar.
 */
export interface CanalDeAviso {
  enviar(texto: string): Promise<void>
}

/**
 * G7.1: todo aviso leva ao fio do projeto no Hub. `?projeto=` é lido pela web ao abrir
 * (`useProjects`). Sem `projectId` não há fio a apontar, e o aviso sai sem link em vez de levar
 * a um projeto qualquer. Mora aqui, e não no `AgentSessionService`, desde o G6.5: as rotinas
 * avisam pelo mesmo canal e não devem depender da sessão para montar o link.
 */
export function linkDoFio(projectId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): string {
  if (!projectId) return ''
  const base = (env.HUB_PUBLIC_URL || 'https://example.com').replace(/\/+$/, '')
  return `\n\n🧵 Abrir no Hub: ${base}/?projeto=${encodeURIComponent(projectId)}`
}

/**
 * G6.5 (21/11): o Telegram envia com `parse_mode: 'Markdown'` e o `send` não confere a resposta.
 * Um `_` solto num ramo (`feature/pr_7`) ou num nome deixa a entidade aberta, o Telegram devolve
 * 400 e o aviso some sem erro nenhum. Todo valor dinâmico passa por aqui antes de entrar no texto.
 */
export function escaparMarkdown(texto: string): string {
  return texto.replace(/([_*`[])/g, '\\$1')
}

/** Token de injeção: interface não existe em runtime, então o Nest resolve por este símbolo. */
export const CANAL_DE_AVISO = Symbol('CANAL_DE_AVISO')

/** Canal atual: o chat raiz do Telegram, como era antes da interface existir. */
@Injectable()
export class CanalTelegram implements CanalDeAviso {
  constructor(private readonly telegram: TelegramService) {}

  enviar(texto: string): Promise<void> {
    return this.telegram.send(texto)
  }
}
