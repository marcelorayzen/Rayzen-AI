import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { AuthService } from './auth.service'
import { IS_PUBLIC_KEY } from './public.decorator'

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private auth: AuthService, private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    const request = context.switchToHttp().getRequest<{ headers: Record<string, string> }>()
    const header = request.headers['authorization'] ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (!token) throw new UnauthorizedException()

    // Aceita JWT (web / MCP / hook) OU AGENT_TOKEN (agent desktop → /agent/session/*)
    if (this.auth.verifyToken(token)) return true
    const agentToken = process.env.AGENT_TOKEN
    if (agentToken && token === agentToken) return true

    throw new UnauthorizedException()
  }
}
