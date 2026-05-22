import { Controller, Post, Body, UnauthorizedException } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { AuthService } from './auth.service'
import { IsString, MinLength } from 'class-validator'

class LoginDto {
  @IsString()
  @MinLength(1)
  password!: string
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly svc: AuthService) {}

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async login(@Body() dto: LoginDto) {
    try {
      return await this.svc.login(dto.password)
    } catch {
      throw new UnauthorizedException('Senha incorreta')
    }
  }
}
