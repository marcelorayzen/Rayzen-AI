import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { matchesServiceToken } from '../auth/service-token'

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

    if (!matchesServiceToken(token)) {
      throw new UnauthorizedException('Token do agent invalido')
    }

    return true
  }
}
