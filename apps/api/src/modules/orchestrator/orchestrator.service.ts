import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../../prisma/prisma.service'
import OpenAI from 'openai'
import { TaskModule, ChatMessage } from '@rayzen/types'
import { getWorkModeConfig } from './work-modes'
import { MemoryService } from '../memory/memory.service'
import { DocumentProcessingService } from '../document-processing/document-processing.service'
import { ExecutionService } from '../execution/execution.service'
import { ContentEngineService } from '../content-engine/content-engine.service'
import { RayzenConfigService } from '../configuration/configuration.service'
import { ValidationService } from '../validation/validation.service'
import { EventService } from '../event/event.service'
import { buildJarvisPayload } from '../execution/jarvis-payload-builder'


export interface ClassifyResult {
  module: TaskModule
  action: string
  confidence: number
}

export interface OrchestrateResult {
  reply: string
  module: TaskModule
  action: string
  confidence: number
  tokensUsed: number
  sessionId: string
}

interface PendingAction {
  action: string
  payload: Record<string, unknown>
  prompt: string
  risk: 'medium' | 'high'
}

const MODULE_ROLE_SUFFIXES: Record<string, string> = {
  jarvis:  '\n\nContexto desta resposta: executei uma tarefa local no PC. Confirme o resultado de forma objetiva e técnica.',
  brain:   '\n\nContexto desta resposta: baseie-se nos documentos e informações da memória semântica. Apresente com confiança — sem ressalvas desnecessárias.',
  doc:     '\n\nContexto desta resposta: geração de documentos técnicos. Use markdown estruturado, listas e seções bem definidas.',
  content: '\n\nContexto desta resposta: criação de conteúdo. Entregue imediatamente, sem introdução.',
}

const CONFIRM_WORDS = /^(confirmar|confirma|sim|ok|pode|executar|executa|yes|run)$/i
const CANCEL_WORDS = /^(cancelar|cancela|n[aã]o|nao|no|cancel)$/i
const ACTION_RISK: Record<string, 'low' | 'medium' | 'high'> = {
  list_dir: 'low',
  file_search: 'low',
  get_system_info: 'low',
  git_status: 'low',
  git_log: 'low',
  docker_ps: 'low',
  inspect_schema: 'low',
  open_app: 'medium',
  open_url: 'medium',
  open_vscode: 'medium',
  create_project_folder: 'medium',
  run_tests: 'medium',
  screenshot: 'medium',
  notify: 'medium',
  clipboard_read: 'medium',
  organize_downloads: 'high',
  clipboard_write: 'high',
  git_branch: 'high',
  git_commit: 'high',
  run_command: 'high',
  docker_start: 'high',
  docker_stop: 'high',
  read_emails: 'medium',
  send_email: 'high',
  get_calendar: 'medium',
}

@Injectable()
export class OrchestratorService {
  private llm: OpenAI

  constructor(
    private readonly prisma: PrismaService,
    private config: ConfigService,
    private memory: MemoryService,
    private documentProcessing: DocumentProcessingService,
    private execution: ExecutionService,
    private contentEngine: ContentEngineService,
    private rayzenConfig: RayzenConfigService,
    private validation: ValidationService,
    private eventService: EventService,
  ) {
    this.llm = new OpenAI({
      baseURL: this.config.get('LITELLM_BASE_URL', 'http://localhost:4000/v1'),
      apiKey: this.config.get('LITELLM_MASTER_KEY'),
    })
  }

  private getRayzenConfig() {
    try { return this.rayzenConfig.getConfig() } catch { return null }
  }

  private getSystemPrompt(module: string): string {
    const cfg = this.getRayzenConfig()
    const base = cfg?.identity.personality ?? 'Seja direto e objetivo. Sem frases de abertura. Português brasileiro.'
    const suffix = MODULE_ROLE_SUFFIXES[module] ?? ''
    return base + suffix
  }

  private actionRisk(action: string): 'low' | 'medium' | 'high' {
    return ACTION_RISK[action] ?? 'high'
  }

  private requiresConfirmation(action: string): boolean {
    return this.actionRisk(action) !== 'low'
  }

  private encodePendingAction(pending: PendingAction): string {
    return Buffer.from(JSON.stringify(pending)).toString('base64')
  }

  private decodePendingAction(encoded: string): PendingAction {
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8')) as PendingAction
  }

  private async lastAssistantMessage(sessionId: string) {
    return this.prisma.conversationMessage.findFirst({
      where: { sessionId, role: 'assistant' },
      orderBy: { createdAt: 'desc' },
    })
  }

  async isPendingDocConfirmation(prompt: string, sessionId: string): Promise<boolean> {
    const CONFIRM_WORDS = /^(confirmar|confirma|sim|ok|pode|pode gerar|gera|gerar|yes|generate)$/i
    if (!CONFIRM_WORDS.test(prompt.trim())) return false
    const lastMsg = await this.lastAssistantMessage(sessionId)
    return !!lastMsg?.content?.includes('[DOC_PENDING:')
  }

  async isPendingActionResponse(prompt: string, sessionId: string): Promise<boolean> {
    if (!CONFIRM_WORDS.test(prompt.trim()) && !CANCEL_WORDS.test(prompt.trim())) return false
    const lastMsg = await this.lastAssistantMessage(sessionId)
    return !!lastMsg?.content?.includes('[ACTION_PENDING:')
  }

  async handleMessage(prompt: string, sessionId: string, projectId?: string, workMode?: string): Promise<OrchestrateResult> {
    // 0. Check for pending doc confirmation before anything else
    const CONFIRM_WORDS = /^(confirmar|confirma|sim|ok|pode|pode gerar|gera|gerar|yes|generate)$/i
    if (CONFIRM_WORDS.test(prompt.trim())) {
      const lastMsg = await this.prisma.conversationMessage.findFirst({
        where: { sessionId, role: 'assistant' },
        orderBy: { createdAt: 'desc' },
      })
      const pendingMatch = lastMsg?.content?.match(/\[DOC_PENDING:([A-Za-z0-9+/=]+)\]/)
      if (pendingMatch) {
        const pendingPrompt = Buffer.from(pendingMatch[1], 'base64').toString('utf-8')
        try {
          const result = await this.documentProcessing.generatePDF(pendingPrompt, sessionId)
          const downloadPath = `/documents/download/${result.fileName}`
          const reply = `Documento gerado: **${result.fileName}** (${Math.round(result.sizeBytes / 1024)}KB)\n\n[⬇ Baixar PDF](${downloadPath})`
          await this.prisma.conversationMessage.createMany({
            data: [
              { sessionId, module: 'doc', role: 'user', content: prompt, projectId, workMode: workMode ?? null },
              { sessionId, module: 'doc', role: 'assistant', content: reply, tokensUsed: 0, projectId, workMode: workMode ?? null },
            ],
          })
          return { reply, module: 'doc', action: 'generate', confidence: 1.0, tokensUsed: 0, sessionId }
        } catch (err) {
          const errReply = `Erro ao gerar documento: ${(err as Error).message}`
          return { reply: errReply, module: 'doc', action: 'generate', confidence: 1.0, tokensUsed: 0, sessionId }
        }
      }
    }

    const actionResponse = CONFIRM_WORDS.test(prompt.trim()) || CANCEL_WORDS.test(prompt.trim())
    if (actionResponse) {
      const lastMsg = await this.lastAssistantMessage(sessionId)
      const actionMatch = lastMsg?.content?.match(/\[ACTION_PENDING:([A-Za-z0-9+/=]+)\]/)
      if (actionMatch) {
        if (CANCEL_WORDS.test(prompt.trim())) {
          const reply = 'Ação cancelada. Nada foi executado.'
          await this.prisma.conversationMessage.createMany({
            data: [
              { sessionId, module: 'jarvis', role: 'user', content: prompt, projectId, workMode: workMode ?? null },
              { sessionId, module: 'jarvis', role: 'assistant', content: reply, tokensUsed: 0, projectId, workMode: workMode ?? null },
            ],
          })
          return { reply, module: 'jarvis', action: 'cancel', confidence: 1, tokensUsed: 0, sessionId }
        }

        const pending = this.decodePendingAction(actionMatch[1])
        return this.executeJarvisAction(pending.action, pending.payload, pending.prompt, sessionId)
      }
    }

    // 1. Validar prompt antes de qualquer processamento
    this.validation.assertValidPrompt(prompt)

    // 1. Classificar intent
    const classify = await this.classify(prompt)

    // 2. Rotear para Brain se necessário
    if (classify.module === 'brain') {
      try {
        const result = await this.memory.searchAndSynthesize(prompt, sessionId)
        this.extractAndIndex(prompt, result.answer)
        return {
          reply: result.answer,
          module: classify.module,
          action: classify.action,
          confidence: classify.confidence,
          tokensUsed: result.tokensUsed,
          sessionId,
        }
      } catch {
        // Fallback para chat normal se embeddings não estiverem disponíveis
      }
    }

    // 3. Rotear para Jarvis se necessário
    if (classify.module === 'jarvis') {
      try {
        const jarvisPayload = buildJarvisPayload(classify.action, prompt)
        if (this.requiresConfirmation(classify.action)) {
          const risk = this.actionRisk(classify.action) as 'medium' | 'high'
          const encoded = this.encodePendingAction({ action: classify.action, payload: jarvisPayload, prompt, risk })
          const reply = [
            `Vou executar uma ação local (${risk === 'high' ? 'alto risco' : 'risco médio'}).`,
            '',
            `**Ação:** \`${classify.action}\``,
            `**Parâmetros:** \`${JSON.stringify(jarvisPayload)}\``,
            '',
            'Confirme para executar ou cancele para abortar.',
            '',
            `[ACTION_PENDING:${encoded}]`,
          ].join('\n')
          await this.prisma.conversationMessage.createMany({
            data: [
              { sessionId, module: 'jarvis', role: 'user', content: prompt, projectId, workMode: workMode ?? null },
              { sessionId, module: 'jarvis', role: 'assistant', content: reply, tokensUsed: 0, projectId, workMode: workMode ?? null },
            ],
          })
          return { reply, module: classify.module, action: classify.action, confidence: classify.confidence, tokensUsed: 0, sessionId }
        }
        const result = await this.execution.dispatch(classify.action, jarvisPayload)
        // Sintetiza resposta natural a partir do resultado
        const synthesis = await this.llm.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `Você é Rayzen, assistente pessoal. O PC Agent executou uma tarefa e retornou dados.
Vá direto ao ponto — apresente os dados imediatamente, sem frases introdutórias como "Olá", "Claro", "Com prazer" ou "Estou aqui para ajudar".
Seja direto, claro e amigável. Português brasileiro. Sem JSON bruto.`,
            },
            {
              role: 'user',
              content: `Pedido original: "${prompt}"\nDados retornados: ${JSON.stringify(result, null, 2)}`,
            },
          ],
          temperature: 0.4,
        })
        return {
          reply: synthesis.choices[0].message.content ?? JSON.stringify(result),
          module: classify.module,
          action: classify.action,
          confidence: classify.confidence,
          tokensUsed: synthesis.usage?.total_tokens ?? 0,
          sessionId,
        }
      } catch (err) {
        return {
          reply: `Não consegui executar a tarefa: ${(err as Error).message}`,
          module: classify.module,
          action: classify.action,
          confidence: classify.confidence,
          tokensUsed: 0,
          sessionId,
        }
      }
    }

    // 4. Rotear para Content se necessário
    if (classify.module === 'content') {
      try {
        const isDiagram = classify.action === 'diagram' || /diagrama|mermaid|fluxo|flowchart|sequence diagram|arquitetura visual/i.test(prompt)
        if (isDiagram) {
          const result = await this.contentEngine.generateDiagram(prompt, sessionId)
          const reply = `**Diagrama (${result.type})**\n\n\`\`\`mermaid\n${result.diagram}\n\`\`\``
          return {
            reply,
            module: classify.module,
            action: 'diagram',
            confidence: classify.confidence,
            tokensUsed: result.tokensUsed,
            sessionId,
          }
        }

        const isCalendar = classify.action === 'calendar' || prompt.toLowerCase().includes('calendário')
        if (isCalendar) {
          const result = await this.contentEngine.generateCalendar(prompt, 7, sessionId)
          const formatted = result.entries
            .map((e) => `Dia ${e.day} — ${e.format.toUpperCase()}: ${e.theme}\n↳ ${e.hook}`)
            .join('\n\n')
          return {
            reply: `Calendário editorial (${result.period}):\n\n${formatted}`,
            module: classify.module,
            action: classify.action,
            confidence: classify.confidence,
            tokensUsed: result.tokensUsed,
            sessionId,
          }
        }

        const type = (['post', 'thread', 'article'].includes(classify.action) ? classify.action : 'post') as 'post' | 'thread' | 'article'
        const result = await this.contentEngine.generate(type, prompt, 'professional', sessionId)
        return {
          reply: result.content,
          module: classify.module,
          action: classify.action,
          confidence: classify.confidence,
          tokensUsed: result.tokensUsed,
          sessionId,
        }
      } catch {
        // Fallback para chat normal
      }
    }

    // 5. Rotear para Doc se necessário — pede confirmação antes de gerar
    if (classify.module === 'doc') {
      const tema = prompt.length > 100 ? prompt.slice(0, 100) + '…' : prompt
      const encoded = Buffer.from(prompt).toString('base64')
      const previewReply = `Vou gerar um documento sobre: **${tema}**\n\nResponda **confirmar** para prosseguir, ou detalhe o que precisa diferente.\n\n[DOC_PENDING:${encoded}]`
      await this.prisma.conversationMessage.createMany({
        data: [
          { sessionId, module: 'doc', role: 'user', content: prompt, projectId, workMode: workMode ?? null },
          { sessionId, module: 'doc', role: 'assistant', content: previewReply, tokensUsed: 0, projectId, workMode: workMode ?? null },
        ],
      })
      return {
        reply: previewReply,
        module: classify.module,
        action: classify.action,
        confidence: classify.confidence,
        tokensUsed: 0,
        sessionId,
      }
    }

    // 4. Carregar histórico da sessão
    const history = await this.prisma.conversationMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      take: 20,
    })

    const historyMessages: ChatMessage[] = history.map((m: { role: string; content: string }) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }))

    // 3. Gerar resposta com contexto do módulo + work mode
    const basePrompt = this.getSystemPrompt(classify.module)
    const modeConfig = getWorkModeConfig(workMode)
    const systemPrompt = modeConfig ? basePrompt + modeConfig.systemPromptSuffix : basePrompt
    const messages: ChatMessage[] = [...historyMessages, { role: 'user', content: prompt }]

    const res = await this.llm.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: 0.7,
    })

    const reply = res.choices[0].message.content ?? ''
    const tokensUsed = res.usage?.total_tokens ?? 0

    // 4. Salvar mensagens no banco
    await this.prisma.conversationMessage.createMany({
      data: [
        { sessionId, module: classify.module, role: 'user', content: prompt, projectId, workMode: workMode ?? null },
        { sessionId, module: classify.module, role: 'assistant', content: reply, tokensUsed, projectId, workMode: workMode ?? null },
      ],
    })

    // 5. Extrair e indexar memória em background (sem bloquear resposta)
    this.extractAndIndex(prompt, reply)

    // 6. Emitir evento de chat
    this.eventService.create({
      projectId,
      source: 'chat',
      type: 'message',
      content: prompt,
      metadata: { module: classify.module, action: classify.action, sessionId, tokensUsed },
    }).catch(() => null)

    return {
      reply,
      module: classify.module,
      action: classify.action,
      confidence: classify.confidence,
      tokensUsed,
      sessionId,
    }
  }

  async classify(prompt: string): Promise<ClassifyResult> {
    if (this.isHowToQuestion(prompt)) {
      return { module: 'system', action: 'answer', confidence: 0.95 }
    }

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `Você é um classificador de intenções. Responda APENAS em JSON.
Módulos disponíveis:
- jarvis: executar tarefas no PC local — abrir apps, listar arquivos, organizar downloads, obter info do sistema (CPU, RAM, disco, SO), capturar screenshot
- content: criar conteúdo — posts, threads, artigos, calendário editorial
- doc: gerar documentos — PDFs, DOCXs, contratos, propostas, relatórios
- brain: memória e busca — indexar, pesquisar, resumir notas e documentos
- system: perguntas sobre o assistente, saudações, o que você pode fazer

Ações do jarvis disponíveis: open_app, open_url, open_vscode, create_project_folder, list_dir, file_search, organize_downloads, get_system_info, screenshot, notify, clipboard_read, clipboard_write, git_status, git_log, git_branch, git_commit, run_command, run_tests, inspect_schema, docker_ps, docker_start, docker_stop, read_emails, send_email, get_calendar
Ações do content disponíveis: post, thread, article, calendar, diagram
Exemplos jarvis: "qual o status do PC", "abra o chrome", "liste os downloads", "coloca música no youtube", "leia meus emails", "manda email para X", "abre o vscode", "crie projeto meu-app nextjs", "tira um screenshot", "me notifica daqui 10 min", "lê minha área de transferência", "git status do projeto X", "quais commits recentes", "cria branch feature/Y", "roda os testes do projeto X", "lista containers docker", "para o container redis", "minha agenda de hoje", "procura arquivo relatorio.pdf", "mostra o schema do banco", "inspeciona o schema prisma"
Exemplos content: "crie um post sobre X", "escreva uma thread sobre Y", "faça um artigo sobre Z", "crie um calendário editorial", "gere um diagrama da arquitetura", "desenhe o fluxo entre API e Agent", "crie um sequence diagram do chat"
Exemplos brain: "qual minha profissão?", "o que você sabe sobre mim?", "qual meu nome?", "o que eu te disse sobre X?", "me fale sobre meus projetos"
Exemplos system: "quem é você", "o que você pode fazer", "olá", "como você funciona", "meu nome é X", "trabalho como Y", "sou Z", "me chamo X", afirmações e apresentações pessoais do usuário

Formato da resposta: { "module": "...", "action": "...", "confidence": 0.0-1.0 }`,
      },
      { role: 'user', content: prompt },
    ]
    const res = await this.llm.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      response_format: { type: 'json_object' },
      temperature: 0,
    })
    const parsed = JSON.parse(res.choices[0].message.content ?? '{}') as ClassifyResult
    if (parsed.module === 'jarvis' && !this.isExplicitExecutionRequest(prompt)) {
      return { module: 'system', action: 'answer', confidence: 0.9 }
    }
    return parsed
  }

  private async executeJarvisAction(
    action: string,
    payload: Record<string, unknown>,
    prompt: string,
    sessionId: string,
  ): Promise<OrchestrateResult> {
    const result = await this.execution.dispatch(action, payload)
    const synthesis = await this.llm.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `VocÃª Ã© Rayzen, assistente pessoal. O PC Agent executou uma tarefa e retornou dados.
VÃ¡ direto ao ponto â€” apresente os dados imediatamente, sem frases introdutÃ³rias como "OlÃ¡", "Claro", "Com prazer" ou "Estou aqui para ajudar".
Seja direto, claro e amigÃ¡vel. PortuguÃªs brasileiro. Sem JSON bruto.`,
        },
        {
          role: 'user',
          content: `Pedido original: "${prompt}"\nDados retornados: ${JSON.stringify(result, null, 2)}`,
        },
      ],
      temperature: 0.4,
    })

    return {
      reply: synthesis.choices[0].message.content ?? JSON.stringify(result),
      module: 'jarvis',
      action,
      confidence: 1,
      tokensUsed: synthesis.usage?.total_tokens ?? 0,
      sessionId,
    }
  }

  private isHowToQuestion(prompt: string): boolean {
    const normalized = prompt.trim().toLowerCase()
    if (!normalized.includes('?')) return false

    return /^(como|qual|quais|quando|onde|por que|porque|me explica|explique)\b/.test(normalized)
      || /\b(como devo|como eu devo|como fa[cç]o|qual seria|qual [ée] a ordem|me orienta|me ensina)\b/.test(normalized)
  }

  private isExplicitExecutionRequest(prompt: string): boolean {
    const normalized = prompt.trim().toLowerCase()
    if (this.isHowToQuestion(prompt)) return false

    return /\b(abra|abre|abrir|liste|lista|listar|crie|cria|criar|rode|roda|rodar|execute|executa|tira|capture|captura|notifica|copie|copia|cole|cola|leia|lÃª|manda|envia|pare|para|inicia|start|stop|procura|busca|encontra|organiza|inspeciona)\b/.test(normalized)
      || /\b(git status|git log|git commit|branch|docker|screenshot|clipboard)\b/.test(normalized)
      || /\b(qual|quais|mostra|minha|meus|minhas)\b.*\b(status do pc|status do computador|info do sistema|commits recentes|agenda|emails|schema)\b/.test(normalized)
  }

  private async extractAndIndex(prompt: string, reply: string): Promise<void> {
    try {
      const res = await this.llm.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Você é um extrator de memória. Analise a mensagem do usuário e responda em JSON.
Se o usuário revelou informações pessoais relevantes (nome, profissão, cidade, projeto, preferência, habilidade, objetivo), retorne:
{ "hasMemory": true, "content": "frase curta descrevendo o fato em 3ª pessoa", "sourcePath": "memoria/auto" }
Se não há informação relevante para memorizar, retorne:
{ "hasMemory": false }
Seja criterioso — não memorize perguntas, comandos ou respostas genéricas.`,
          },
          { role: 'user', content: `Mensagem do usuário: "${prompt}"` },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
      })

      const extracted = JSON.parse(res.choices[0].message.content ?? '{"hasMemory":false}')
      if (extracted.hasMemory && extracted.content) {
        console.log('[extractAndIndex] indexando:', extracted.content)
        await this.memory.indexDocument(extracted.content, extracted.sourcePath ?? 'memoria/auto', {
          auto: true,
          originalPrompt: prompt.slice(0, 100),
        })
      }
    } catch (err) {
      console.error('[extractAndIndex] falhou:', (err as Error).message)
    }
  }

  async streamChat(prompt: string, sessionId: string, module: string, onToken: (token: string) => void, projectId?: string, workMode?: string): Promise<void> {
    const history = await this.prisma.conversationMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      take: 20,
    })

    const historyMessages: ChatMessage[] = history.map((m: { role: string; content: string }) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }))

    const basePrompt = this.getSystemPrompt(module)
    const modeConfig = getWorkModeConfig(workMode)
    const systemPrompt = modeConfig ? basePrompt + modeConfig.systemPromptSuffix : basePrompt
    const messages: ChatMessage[] = [...historyMessages, { role: 'user', content: prompt }]

    const stream = await this.llm.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: 0.7,
      stream: true,
    })

    let fullReply = ''
    let tokensUsed = 0

    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content ?? ''
      if (token) {
        fullReply += token
        onToken(token)
      }
      if (chunk.usage) tokensUsed = chunk.usage.total_tokens
    }

    await this.prisma.conversationMessage.createMany({
      data: [
        { sessionId, module, role: 'user', content: prompt, projectId, workMode: workMode ?? null },
        { sessionId, module, role: 'assistant', content: fullReply, tokensUsed, projectId, workMode: workMode ?? null },
      ],
    })

    // Extrair e indexar memória em background
    this.extractAndIndex(prompt, fullReply)

    // Emitir evento de chat
    this.eventService.create({
      projectId,
      source: 'chat',
      type: 'message',
      content: prompt,
      metadata: { module, sessionId, tokensUsed },
    }).catch(() => null)
  }

  async chat(messages: ChatMessage[], systemPrompt: string): Promise<string> {
    const res = await this.llm.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: 0.7,
    })
    return res.choices[0].message.content ?? ''
  }
}
