import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { timingSafeEqual } from 'crypto'

@Injectable()
export class AgentTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>()
    const configuredToken = process.env.AGENT_TOKEN

    if (!configuredToken) {
      throw new UnauthorizedException('AGENT_TOKEN nao configurado no servidor')
    }

    const auth = req.headers?.authorization ?? ''
    const [scheme, token] = auth.split(' ')

    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Token do agent invalido')
    }

    const a = Buffer.from(token.padEnd(configuredToken.length))
    const b = Buffer.from(configuredToken)
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Token do agent invalido')
    }

    return true
  }
}
