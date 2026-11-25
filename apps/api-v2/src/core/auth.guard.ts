import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { FastifyRequest } from 'fastify'
import { IS_PUBLIC_KEY } from './public.decorator'

export interface AuthPrincipal {
  kind: 'human' | 'service'
  subject: string
  role?: string
}

export type AuthenticatedRequest = FastifyRequest & { authPrincipal?: AuthPrincipal }

function tokenDeServico(token: string): boolean {
  return [process.env.AGENT_TOKEN, process.env.AGENT_TOKEN_PREVIOUS]
    .filter((value): value is string => Boolean(value))
    .some((value) => token === value)
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ])
    if (isPublic) return true

    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>()
    const auth = req.headers.authorization
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException()

    const token = auth.slice(7)

    // The configured identity takes precedence over token format. In production
    // AGENT_TOKEN may itself be a valid JWT; verifying it first would promote a
    // service to a human principal and bypass owner-only decisions.
    if (tokenDeServico(token)) {
      req.authPrincipal = { kind: 'service', subject: 'agent' }
      return true
    }

    try {
      const payload = this.jwt.verify<{ sub?: string; role?: string }>(token)
      req.authPrincipal = {
        kind: 'human',
        subject: typeof payload?.sub === 'string' ? payload.sub : 'jwt-user',
        role: typeof payload?.role === 'string' ? payload.role : undefined,
      }
      return true
    } catch {
      throw new UnauthorizedException()
    }
  }
}
