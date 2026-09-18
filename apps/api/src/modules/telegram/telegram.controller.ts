import { Controller, Get } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { TelegramService } from './telegram.service'

/**
 * ── Por que esta rota NÃO vive no HealthModule ───────────────────────────────
 *
 * A primeira tentativa colocou `GET /infra/telegram` no `InfraHealthController`, o que exigia
 * `HealthModule → TelegramModule`. Isso fechou um ciclo e **derrubou a API em produção**:
 *
 *     AppModule → OrchestratorModule → MemoryModule → EventModule → SynthesisModule →
 *     DocumentationModule → ProjectStateModule → HealthModule → TelegramModule →
 *     ProjectStateModule …
 *
 * O `ProjectStateModule` já importava o `HealthModule`, então bastou o Telegram entrar no Health
 * para o grafo se fechar. O Nest não sobe, o container entra em `Restarting`, e **o typecheck
 * passa** — dependência circular de MÓDULO não é erro de tipo.
 *
 * Aqui dentro não há import novo: o controller usa o serviço do próprio módulo. É o mesmo motivo
 * pelo qual `PendingReplyService` ganhou módulo próprio e pelo qual o `TelegramService` chama o
 * orquestrador por HTTP em vez de injetá-lo.
 *
 * A rota continua sob o prefixo `infra` para ficar ao lado de `/infra/health`, que é o lugar onde
 * se procura saúde de componente — o agrupamento é da URL, não do módulo.
 */
@ApiTags('health')
@Controller('infra')
export class TelegramController {
  constructor(private readonly telegram: TelegramService) {}

  /**
   * Saúde do canal — sem enviar mensagem, sem criar conversa, sem gastar LLM.
   *
   * NÃO é `@Public()`, ao contrário de `/infra/health`: expõe contagem de chats e o estado da
   * credencial, que é informação de configuração. O invariante `telegram_responde` da V2 chama
   * esta rota com o `AGENT_TOKEN`.
   */
  @Get('telegram')
  @ApiOperation({ summary: 'Canal do Telegram — bot, polling, credencial do orquestrador e vínculo de projeto' })
  health() {
    return this.telegram.diagnostico()
  }
}
