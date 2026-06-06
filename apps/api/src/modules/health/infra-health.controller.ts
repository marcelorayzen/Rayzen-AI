import { Controller, Get } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { Public } from '../auth/public.decorator'
import { InfraHealthService } from './infra-health.service'

@ApiTags('health')
@Controller('infra')
export class InfraHealthController {
  constructor(private readonly svc: InfraHealthService) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Status de infraestrutura — postgres, redis, litellm, api-v2, mcp, hook-jwt' })
  check() {
    return this.svc.check()
  }
}
