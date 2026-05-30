import {
  Controller, Get, Post, Delete,
  Param, Body, Query, UseGuards, HttpCode,
} from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger'
import { IsString, IsNotEmpty } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'
import { VaultService } from './vault.service'
import { VaultScanService } from './vault-scan.service'
import { JwtAuthGuard } from '../core/auth.guard'

class SetSecretDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  key!: string

  @ApiProperty({ description: 'Secret value — stored encrypted, never returned via API' })
  @IsString()
  @IsNotEmpty()
  value!: string
}

class ScanDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  text!: string
}

@ApiTags('vault')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('vault')
export class VaultController {
  constructor(
    private readonly vault: VaultService,
    private readonly scanner: VaultScanService,
  ) {}

  @Post(':project/secrets')
  @HttpCode(204)
  async set(@Param('project') project: string, @Body() dto: SetSecretDto) {
    await this.vault.set(project, dto.key, dto.value)
  }

  @Get(':project/secrets')
  list(@Param('project') project: string) {
    return this.vault.list(project)
  }

  @Delete(':project/secrets/:key')
  @HttpCode(204)
  async delete(@Param('project') project: string, @Param('key') key: string) {
    await this.vault.delete(project, key)
  }

  @Get(':project/audit')
  @ApiQuery({ name: 'limit', required: false })
  audit(@Param('project') project: string, @Query('limit') limit?: string) {
    return this.vault.getAuditLog(project, limit ? parseInt(limit) : 50)
  }

  @Post('scan')
  @HttpCode(200)
  scan(@Body() dto: ScanDto) {
    return this.scanner.scan(dto.text)
  }
}
