import { Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import * as argon2 from 'argon2'
import { timingSafeEqual } from 'crypto'

@Injectable()
export class AuthService {
  constructor(private config: ConfigService, private jwt: JwtService) {}

  async login(password: string): Promise<{ token: string }> {
    const adminPassword = this.config.get<string>('ADMIN_PASSWORD') ?? ''
    if (!adminPassword) throw new UnauthorizedException('Senha incorreta')

    const allowPlaintext = this.config.get('ALLOW_PLAINTEXT_ADMIN_PASSWORD', 'true') !== 'false'

    let valid: boolean
    if (adminPassword.startsWith('$argon2')) {
      valid = await argon2.verify(adminPassword, password)
    } else if (allowPlaintext) {
      valid = timingSafeEqual(Buffer.from(password), Buffer.from(adminPassword))
    } else {
      throw new UnauthorizedException('Senha incorreta')
    }

    if (!valid) throw new UnauthorizedException('Senha incorreta')

    const token = this.jwt.sign({ sub: 'admin', role: 'admin' })
    return { token }
  }

  verifyToken(token: string): boolean {
    try {
      this.jwt.verify(token)
      return true
    } catch {
      return false
    }
  }
}
