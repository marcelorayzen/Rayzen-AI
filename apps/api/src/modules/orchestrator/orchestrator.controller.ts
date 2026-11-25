import { Controller, Post, Body, Res } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { OrchestratorService } from './orchestrator.service'
import { SessionService, type RegistroDeDecisao } from '../session/session.service'
import { IsString, MinLength, IsOptional } from 'class-validator'
import { randomUUID } from 'crypto'
import { FastifyReply } from 'fastify'

class PromptDto {
  @IsString()
  @MinLength(1)
  prompt!: string

  @IsOptional()
  @IsString()
  sessionId?: string

  @IsOptional()
  @IsString()
  projectId?: string

  @IsOptional()
  @IsString()
  workMode?: string
}

@ApiTags('orchestrator')
@ApiBearerAuth()
@Controller('orchestrate')
export class OrchestratorController {
  constructor(
    private readonly svc: OrchestratorService,
    private readonly sessions: SessionService,
  ) {}

  /**
   * ── Uma decisão declarada vira evento, qualquer que seja a porta ────────────
   *
   * Até 18/09 isto valia só para o HUB: a mesma frase dita no chat da web ou no Telegram não
   * chegava à timeline do projeto. Os três são o mesmo cérebro e, desde 18/09, o mesmo fio de
   * conversa — a regra é que estava num canto só.
   *
   * Aqui é o ponto onde os três se encontram: o Telegram fala com a própria api por
   * `POST /orchestrate` (de propósito, para não fechar ciclo de módulo), e a web usa as duas
   * rotas abaixo. Pôr isto dentro do orquestrador espalharia a regra por dez pontos de gravação.
   *
   * ── Corre EM PARALELO ao turno, e o resultado volta junto com ele ──────────
   *
   * Disparado sem `await` aqui: o insert acontece enquanto o LLM pensa, então não custa latência
   * nenhuma. Quem chama guarda a promessa e a colhe no fim, para poder **dizer** se registrou.
   *
   * Dizer importa porque o objetivo do projeto é *"o que decide fica registrado"* — e uma
   * interface que afirma isso sem perguntar ao servidor estaria afirmando o que não mediu. É a
   * mesma razão pela qual o `avisou` do panorama parou de sair da intenção de avisar.
   *
   * O `.catch` é cinto: `registrarDecisaoDeclarada` já não lança, e se um dia lançar, quem paga
   * não pode ser quem está esperando resposta.
   */
  private registrarDecisao(dto: PromptDto, sessionId: string): Promise<RegistroDeDecisao> {
    return this.sessions
      .registrarDecisaoDeclarada({
        texto:     dto.prompt,
        sessionId,
        projectId: dto.projectId,
        canal:     'chat',
      })
      .catch((): RegistroDeDecisao => 'falhou')
  }

  @Post()
  async handle(@Body() dto: PromptDto) {
    const sessionId = dto.sessionId ?? randomUUID()
    const registro  = this.registrarDecisao(dto, sessionId)
    const resultado = await this.svc.handleMessage(dto.prompt, sessionId, dto.projectId, dto.workMode)
    return { ...resultado, decisao: await registro }
  }

  @Post('stream')
  async stream(@Body() dto: PromptDto, @Res() reply: FastifyReply) {
    const sessionId = dto.sessionId ?? randomUUID()
    const registro  = this.registrarDecisao(dto, sessionId)

    reply.hijack()
    const raw = reply.raw
    raw.setHeader('Content-Type', 'text/event-stream')
    raw.setHeader('Cache-Control', 'no-cache')
    raw.setHeader('Connection', 'keep-alive')
    raw.setHeader('Access-Control-Allow-Origin', '*')
    raw.flushHeaders()

    const send = (event: string, data: unknown) => {
      raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    /**
     * O `done` sai de um lugar só — havia quatro, um por ramo de classificação.
     *
     * Acrescentar `decisao` em cada um seria espalhar de novo a regra que esta mudança existe
     * para centralizar, e o ramo esquecido não daria erro: diria ao cliente que nada foi
     * registrado, que é pior que não dizer nada.
     *
     * É aqui que a promessa do registro é colhida. Ela foi disparada antes do turno, então
     * esperá-la no fim quase sempre já encontra pronta.
     */
    const concluir = async (tokensUsed: number) => {
      send('done', { tokensUsed, sessionId, decisao: await registro })
    }

    try {
      // Verificar se é confirmação de doc pendente antes de classificar
      if (await this.svc.isPendingDocConfirmation(dto.prompt, sessionId)) {
        const result = await this.svc.handleMessage(dto.prompt, sessionId, dto.projectId, dto.workMode)
        send('classify', { module: 'doc', action: 'generate', sessionId })
        send('token', { text: result.reply })
        await concluir(result.tokensUsed)
        raw.end()
        return
      }

      if (await this.svc.isPendingActionResponse(dto.prompt, sessionId)) {
        const result = await this.svc.handleMessage(dto.prompt, sessionId, dto.projectId, dto.workMode)
        send('classify', { module: 'jarvis', action: result.action, sessionId })
        send('token', { text: result.reply })
        await concluir(result.tokensUsed)
        raw.end()
        return
      }

      // Classificar primeiro (rápido)
      const classify = await this.svc.classify(dto.prompt)
      send('classify', { module: classify.module, action: classify.action, sessionId })

      // Módulos não-streaming (jarvis, brain, doc, content) — usa handleMessage normal
      const nonStreaming = ['jarvis', 'brain', 'doc', 'content']
      if (nonStreaming.includes(classify.module)) {
        const result = await this.svc.handleMessage(dto.prompt, sessionId, dto.projectId, dto.workMode)
        send('token', { text: result.reply })
        await concluir(result.tokensUsed)
        reply.raw.end()
        return
      }

      // Chat geral — streaming real
      await this.svc.streamChat(dto.prompt, sessionId, classify.module, (token) => {
        send('token', { text: token })
      }, dto.projectId, dto.workMode)

      await concluir(0)
    } catch (err) {
      send('error', { message: (err as Error).message })
    } finally {
      raw.end()
    }
  }
}
