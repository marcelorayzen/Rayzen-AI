import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { timingSafeEqual } from 'crypto'
import { IS_PUBLIC_KEY } from './public.decorator'

// Guarda única para todo o app — cliente de consultoria roda isto standalone,
// sem IdP próprio. Mesmo padrão do AgentTokenGuard em apps/api (Bearer
// estático, timingSafeEqual). Identidade do usuário de negócio (userId/profile
// no body de /query) é um problema separado — ver README § Backlog.
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    const req = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>()
    const configuredKey = process.env.CATALOG_GUARDIAN_API_KEY

    if (!configuredKey) {
      throw new UnauthorizedException('CATALOG_GUARDIAN_API_KEY nao configurado no servidor')
    }

    const auth = req.headers?.authorization ?? ''
    const [scheme, token] = auth.split(' ')

    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Chave de API invalida')
    }

    const a = Buffer.from(token.padEnd(configuredKey.length))
    const b = Buffer.from(configuredKey)
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Chave de API invalida')
    }

    return true
  }
}
