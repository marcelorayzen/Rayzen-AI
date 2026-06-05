import Anthropic from '@anthropic-ai/sdk'
import type { BrowserWindow } from 'electron'

export interface ClaudeContext {
  projectName:    string
  activeMissions: { title: string; objective: string; status: string }[]
}

interface Turn { role: 'user' | 'assistant'; content: string }

// Histórico de conversa por projectId (em memória, dura enquanto o widget estiver aberto)
const history = new Map<string, Turn[]>()

function getHistory(projectId: string): Turn[] {
  if (!history.has(projectId)) history.set(projectId, [])
  return history.get(projectId)!
}

function buildSystemPrompt(ctx?: ClaudeContext): string {
  const base = 'Você é o assistente do widget Rayzen. Respostas curtas e diretas. Use markdown simples.'
  if (!ctx) return base

  const missions = ctx.activeMissions
    .filter((m) => m.status === 'active' || m.status === 'pending')
    .slice(0, 5)
    .map((m) => `  • [${m.status}] ${m.title}: ${m.objective}`)
    .join('\n')

  return [
    base,
    `Projeto ativo: **${ctx.projectName}**`,
    missions ? `Missões abertas:\n${missions}` : null,
  ].filter(Boolean).join('\n\n')
}

export class ClaudeApiChat {
  private static client: Anthropic | null = null

  private static getClient(): Anthropic {
    if (!ClaudeApiChat.client) {
      const apiKey = process.env.ANTHROPIC_API_KEY
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada')
      ClaudeApiChat.client = new Anthropic({ apiKey })
    }
    return ClaudeApiChat.client
  }

  static clearHistory(projectId: string) {
    history.delete(projectId)
  }

  // Streaming: envia chunks via IPC para o renderer
  static async stream(
    projectId: string,
    message:   string,
    ctx:       ClaudeContext | undefined,
    win:       BrowserWindow,
    model      = 'claude-haiku-4-5-20251001',
  ): Promise<void> {
    const client = ClaudeApiChat.getClient()
    const turns  = getHistory(projectId)

    turns.push({ role: 'user', content: message })

    // Mantém no máximo 20 turns para não explodir o contexto
    if (turns.length > 20) turns.splice(0, turns.length - 20)

    let fullReply = ''

    try {
      const stream = client.messages.stream({
        model,
        max_tokens: 1024,
        system:     buildSystemPrompt(ctx),
        messages:   turns.map((t) => ({ role: t.role, content: t.content })),
      })

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          fullReply += event.delta.text
          win.webContents.send('claude:chunk', { text: event.delta.text, done: false })
        }
      }

      // Confirma fim do stream
      win.webContents.send('claude:chunk', { text: '', done: true })

      // Salva resposta no histórico
      if (fullReply) turns.push({ role: 'assistant', content: fullReply })

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      win.webContents.send('claude:chunk', { text: '', done: true, error: msg })
      // Remove a mensagem do usuário do histórico se falhou
      turns.pop()
    }
  }
}
