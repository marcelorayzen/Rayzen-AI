import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { GitService, GitEventPayload } from './git.service'

@ApiTags('git')
@Controller()
export class GitController {
  constructor(private readonly svc: GitService) {}

  @Post('events/git')
  @ApiOperation({ summary: 'Recebe webhook do GitHub (push, pull_request) e salva como evento' })
  webhook(@Body() payload: GitEventPayload, @Query('project_id') projectId?: string) {
    return this.svc.fromWebhook(payload, projectId)
  }

  @Get('projects/:id/git')
  @ApiOperation({ summary: 'Contexto git agregado do projeto: branches, commits recentes, arquivos mais tocados' })
  context(@Param('id') id: string) {
    return this.svc.getProjectContext(id)
  }
}
