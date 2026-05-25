import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name)
  private readonly token: string
  private readonly chatId: string
  private readonly baseUrl: string
  private offset = 0
  private pollTimer: NodeJS.Timeout | null = null
  private replyHandler: ((text: string) => void) | null = null

  constructor(private readonly config: ConfigService) {
    this.token = this.config.get<string>('TELEGRAM_BOT_TOKEN') ?? ''
    this.chatId = this.config.get<string>('TELEGRAM_CHAT_ID') ?? ''
    this.baseUrl = `https://api.telegram.org/bot${this.token}`
  }

  onModuleInit() {
    if (!this.token || !this.chatId) {
      this.logger.warn('TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — Telegram disabled')
      return
    }
    this.startPolling()
  }

  onModuleDestroy() {
    if (this.pollTimer) clearTimeout(this.pollTimer)
  }

  setReplyHandler(handler: (text: string) => void) {
    this.replyHandler = handler
  }

  clearReplyHandler() {
    this.replyHandler = null
  }

  async send(text: string): Promise<void> {
    if (!this.token || !this.chatId) return
    try {
      const url = `${this.baseUrl}/sendMessage`
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: this.chatId, text, parse_mode: 'Markdown' }),
      })
    } catch (err) {
      this.logger.error('Telegram send failed', err)
    }
  }

  async sendPhoto(imageUrl: string, caption: string): Promise<void> {
    if (!this.token || !this.chatId) return
    try {
      const url = `${this.baseUrl}/sendPhoto`
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: this.chatId, photo: imageUrl, caption }),
      })
    } catch (err) {
      this.logger.error('Telegram sendPhoto failed', err)
    }
  }

  private startPolling() {
    const poll = async () => {
      try {
        const url = `${this.baseUrl}/getUpdates?offset=${this.offset}&timeout=20&allowed_updates=["message"]`
        const res = await fetch(url)
        const data = await res.json() as { ok: boolean; result: TelegramUpdate[] }

        if (data.ok && data.result.length > 0) {
          for (const update of data.result) {
            this.offset = update.update_id + 1
            const text = update.message?.text?.trim()
            const fromId = String(update.message?.chat?.id ?? '')

            if (!text || fromId !== this.chatId) continue

            if (text === '/status') {
              await this.send('✅ Rayzen AI online. Nenhuma sessão supervisionada ativa no momento.')
            } else if (this.replyHandler) {
              this.replyHandler(text)
            } else {
              await this.send('Nenhuma sessão ativa. Inicie uma sessão supervisionada pelo chat Rayzen para usar o bot.')
            }
          }
        }
      } catch {
        // network hiccup — keep polling
      }
      this.pollTimer = setTimeout(poll, 1000)
    }

    poll()
    this.logger.log('Telegram long-polling started')
  }
}

interface TelegramUpdate {
  update_id: number
  message?: {
    text?: string
    chat?: { id: number }
  }
}
