import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { createHash, timingSafeEqual } from 'crypto'

/** Quem foi autenticado. Derivado do guard — nunca do corpo da requisição. */
export interface Principal {
  id:   string
  type: 'approval_token'
}

/**
 * Guard da CRIAÇÃO de aprovação — Fase 5-A.
 *
 * Deliberadamente **não** é o `AgentTokenGuard`. Ele compara contra `AGENT_TOKEN`, que o agent
 * possui: usá-lo aqui deixaria o agent criar as próprias aprovações e trocaria `force: true` por
 * uma volta a mais no mesmo lugar.
 *
 * `APPROVAL_TOKEN` é credencial separada, que vive só no servidor. Ela **não** entra no `.env` do
 * agent, **não** entra na allowlist de ambiente da sessão supervisionada, e **não** é herdada por
 * processo-filho. Se um dia entrar, a separação morre em silêncio — por isso há teste.
 *
 * Sem `APPROVAL_TOKEN` configurado, a rota **fecha**. Aprovação é justamente o que não pode cair
 * para "aberto" quando a configuração falta.
 */
@Injectable()
export class ApprovalTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; principal?: Principal }>()
    const esperado = process.env.APPROVAL_TOKEN

    if (!esperado) {
      throw new UnauthorizedException(
        'APPROVAL_TOKEN não configurado — criação de aprovação indisponível (falha fechada)',
      )
    }

    // Recusa explícita se alguém apontar as duas variáveis para o mesmo valor: seria a separação
    // desfeita sem ninguém perceber, que é pior que não ter separação nenhuma.
    if (process.env.AGENT_TOKEN && process.env.AGENT_TOKEN === esperado) {
      throw new UnauthorizedException(
        'APPROVAL_TOKEN igual ao AGENT_TOKEN — o agent poderia se autoaprovar',
      )
    }

    const auth = req.headers?.authorization ?? ''
    const [scheme, token] = auth.split(' ')
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('Token de aprovação inválido')

    const a = Buffer.from(token.padEnd(esperado.length))
    const b = Buffer.from(esperado)
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Token de aprovação inválido')
    }

    // A identidade de quem aprovou é DERIVADA do que foi autenticado, nunca lida do corpo.
    // Antes o `createdBy` vinha no payload: era um campo de auditoria preenchido por quem
    // está sendo auditado. O id é um prefixo do sha256 do token — estável, comparável entre
    // registros, e não revela o segredo nem por comprimento.
    ;(req as { principal?: Principal }).principal = {
      id:   `approval-token:${createHash('sha256').update(esperado).digest('hex').slice(0, 12)}`,
      type: 'approval_token',
    }

    return true
  }
}
