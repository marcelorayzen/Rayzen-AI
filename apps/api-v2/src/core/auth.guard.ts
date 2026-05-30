import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { FastifyRequest } from 'fastify'

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>()
    const auth = req.headers.authorization
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException()

    try {
      this.jwt.verify(auth.slice(7))
      return true
    } catch {
      throw new UnauthorizedException()
    }
  }
}
