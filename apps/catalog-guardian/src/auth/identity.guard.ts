import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'

export interface IdentityRequest {
  headers: Record<string, string | undefined>
  identityUserId?: string
}

// Verifica o JWT de identidade assinado pelo backend do cliente (claim `sub`
// = userId) — nunca confia num userId solto no body. Ver IdentityJwtModule
// pro porquê. Anexa o userId verificado em request.identityUserId; o
// controller lê dali, não do body.
@Injectable()
export class IdentityGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<IdentityRequest>()
    const token = req.headers?.['x-identity-token']

    if (!token) {
      throw new UnauthorizedException('Header X-Identity-Token ausente')
    }

    let payload: { sub?: string }
    try {
      payload = this.jwt.verify(token)
    } catch {
      throw new UnauthorizedException('Token de identidade inválido ou expirado')
    }

    if (!payload.sub) {
      throw new UnauthorizedException('Token de identidade sem claim "sub" (userId)')
    }

    req.identityUserId = payload.sub
    return true
  }
}
