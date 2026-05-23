import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { AuthService } from './auth.service'

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string> }>()
    const header = request.headers['authorization'] ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (!token || !this.auth.verifyToken(token)) {
      throw new UnauthorizedException()
    }
    return true
  }
}
