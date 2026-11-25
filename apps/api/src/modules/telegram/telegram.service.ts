import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

/**
 * ── O Telegram é só saída, desde a S5.6 (21/11/2026) ─────────────────────────
 *
 * Até aqui este serviço também LIA o Telegram: long-polling, chat livre para o orquestrador da V1,
 * comandos (`/projeto`, `/status`, `/goal`, `/eventos`, `/checkpoint`, `/autorizar`, `/ajuda`) e
 * resposta a sessão supervisionada. Medido antes de remover (ver o item S5 do backlog): o
 * orquestrador foi usado pela última vez em 19/10, e não havia mensagem de chat em 90 dias. O Hub
 * cobre o resto: a pergunta e a aprovação da sessão aparecem no fio (S1d) e todo aviso leva o link
 * do fio (G7.1). Decisão do Marcelo em 21/11: o bot deixa de ler o que se escreve nele.
 *
 * O que ficou: enviar avisos (`send`, usado pelo `CanalTelegram` das sessões) e dizer se o bot
 * consegue enviar (`diagnostico`, sondado pelo invariante `telegram_responde`). Sair uma porta que
 * interpretava texto livre é parte do ganho, não efeito colateral.
 *
 * Os alertas de deploy, invariante e panorama NÃO passam por aqui: falam direto com a API do
 * Telegram, para que a api caída não precise anunciar a própria queda.
 */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name)
  private readonly token: string
  private readonly chatId: string
  private readonly baseUrl: string

  constructor(private readonly config: ConfigService) {
    this.token  = this.config.get<string>('TELEGRAM_BOT_TOKEN') ?? ''
    this.chatId = this.config.get<string>('TELEGRAM_CHAT_ID')  ?? ''
    this.baseUrl = `https://api.telegram.org/bot${this.token}`
  }

  /**
   * `chatId` e `threadId` continuam opcionais para não quebrar quem chama `send(texto)`; sem eles,
   * o aviso vai para o chat raiz (`TELEGRAM_CHAT_ID`).
   */
  async send(text: string, chatId?: string, threadId?: string): Promise<void> {
    if (!this.token) return
    const target = chatId ?? this.chatId
    if (!target) return
    try {
      await fetch(`${this.baseUrl}/sendMessage`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: target,
          text: text.slice(0, 4096),
          parse_mode: 'Markdown',
          ...(threadId ? { message_thread_id: Number(threadId) } : {}),
        }),
      })
    } catch (err) {
      this.logger.error('Telegram send failed', err)
    }
  }

  async sendPhoto(imageUrl: string, caption: string): Promise<void> {
    if (!this.token || !this.chatId) return
    try {
      await fetch(`${this.baseUrl}/sendPhoto`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: this.chatId, photo: imageUrl, caption }),
      })
    } catch (err) {
      this.logger.error('Telegram sendPhoto failed', err)
    }
  }

  /**
   * O bot consegue enviar? Pergunta à API do Telegram com `getMe`, que confirma o token sem mandar
   * mensagem nenhuma. Sem `ok` do Telegram, o canal está quebrado mesmo com as variáveis
   * definidas — token revogado tem exatamente a cara de token configurado.
   *
   * Falha de REDE ao falar com o Telegram é `inconclusivo`, não falha: quem não respondeu pode ser
   * a rede do servidor, e o sensor não pode culpar o alvo errado.
   */
  async diagnostico(): Promise<{
    ok: boolean
    botConfigurado: boolean
    botResponde: 'sim' | 'nao' | 'inconclusivo'
    detalhe: string
  }> {
    const botConfigurado = Boolean(this.token && this.chatId)
    if (!botConfigurado) {
      return { ok: false, botConfigurado, botResponde: 'nao', detalhe: 'TELEGRAM_BOT_TOKEN/CHAT_ID ausente' }
    }

    try {
      const res = await fetch(`${this.baseUrl}/getMe`, { signal: AbortSignal.timeout(10_000) })
      const corpo = await res.json().catch(() => null) as { ok?: boolean; description?: string } | null
      if (res.ok && corpo?.ok === true) {
        return { ok: true, botConfigurado, botResponde: 'sim', detalhe: 'bot responde — avisos podem sair' }
      }
      return {
        ok: false,
        botConfigurado,
        botResponde: 'nao',
        detalhe: `getMe respondeu ${res.status}${corpo?.description ? ` (${corpo.description})` : ''} — token inválido ou revogado`,
      }
    } catch (err) {
      return {
        ok: true,
        botConfigurado,
        botResponde: 'inconclusivo',
        detalhe: `Inconclusivo — não alcancei a API do Telegram (${String(err).slice(0, 80)})`,
      }
    }
  }
}
