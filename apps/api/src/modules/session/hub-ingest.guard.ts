import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { timingSafeEqual } from 'crypto'

/**
 * ── Credencial ESCOPADA a uma rota, não o `AGENT_TOKEN` inteiro ─────────────
 *
 * O HUB precisa escrever a conversa no Rayzen. O `JwtAuthGuard` global aceita JWT **ou**
 * `AGENT_TOKEN`, e nenhum dos dois tem escopo: dar qualquer um deles ao Hermes daria a API inteira
 * a um serviço que **está exposto na internet** desde 18/09.
 *
 * Então a rota de ingestão tem token próprio, como os consumidores do MCP (Fase 8): revogável
 * sozinho, sem derrubar ninguém, e nomeável no log.
 *
 * ── Falha FECHADA quando a variável não existe ──────────────────────────────
 *
 * Sem `HUB_INGEST_TOKEN` a rota recusa tudo, em vez de ficar aberta. É o inverso exato do defeito
 * de `MCP_TOKEN_HERMES` em 13/09: lá a variável vazia fazia o token ser descartado e o consumidor
 * simplesmente não existia; aqui um valor ausente não pode virar "qualquer um entra".
 *
 * A comparação é de tempo constante. `===` em segredo é oráculo de tempo, e a diferença de custo
 * é zero — o próprio plugin de senha do Hermes faz isso.
 */
@Injectable()
export class HubIngestGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const esperado = process.env.HUB_INGEST_TOKEN ?? ''
    if (!esperado) throw new UnauthorizedException()

    const req    = context.switchToHttp().getRequest<{ headers: Record<string, string> }>()
    const header = req.headers['authorization'] ?? ''
    const token  = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (!token) throw new UnauthorizedException()

    if (!iguaisEmTempoConstante(token, esperado)) throw new UnauthorizedException()
    return true
  }
}

/**
 * `timingSafeEqual` **lança** com tamanhos diferentes, então o comprimento vaza de qualquer jeito
 * — comparar o tamanho antes é honesto e evita a exceção. O que fica protegido é o conteúdo.
 */
export function iguaisEmTempoConstante(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}
