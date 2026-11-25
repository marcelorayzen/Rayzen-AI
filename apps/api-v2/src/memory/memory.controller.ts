import {
  Controller, Get, Post, Delete, Patch,
  Param, Body, Query, UseGuards, HttpCode, Req,
} from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger'
import { MemoryService } from './memory.service'
import { StoreMemoryDto, SearchMemoryDto, UpdateClassDto, MemoryClass, MemoryType } from './dto/memory.dto'
import { JwtAuthGuard } from '../core/auth.guard'
import type { AuthenticatedRequest } from '../core/auth.guard'
import { KnowledgeGovernanceService } from './knowledge-governance.service'
import {
  CreateKnowledgeProposalDto, KnowledgeDecisionDto, ListKnowledgeProposalDto,
  KnowledgeScope,
} from './dto/knowledge.dto'

@ApiTags('memory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('memory')
export class MemoryController {
  constructor(
    private readonly memory: MemoryService,
    private readonly knowledge: KnowledgeGovernanceService,
  ) {}

  @Post('knowledge/proposals')
  createProposal(@Body() dto: CreateKnowledgeProposalDto, @Req() req: AuthenticatedRequest) {
    return this.knowledge.createProposal(dto, req.authPrincipal!)
  }

  @Get('knowledge/proposals')
  listProposals(@Query() query: ListKnowledgeProposalDto) {
    return this.knowledge.listProposals(query)
  }

  @Post('knowledge/proposals/:id/approve')
  approveProposal(
    @Param('id') id: string,
    @Body() dto: KnowledgeDecisionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.knowledge.approve(id, dto, req.authPrincipal!)
  }

  @Post('knowledge/proposals/:id/reject')
  rejectProposal(
    @Param('id') id: string,
    @Body() dto: KnowledgeDecisionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.knowledge.reject(id, dto, req.authPrincipal!)
  }

  @Get('knowledge/canonical')
  listCanonical(
    @Query('scopeType') scopeType: KnowledgeScope,
    @Query('projectId') projectId?: string,
  ) {
    return this.knowledge.listCanonical(scopeType, projectId)
  }

  @Post('knowledge/:id/projections/vector/rebuild')
  rebuildVectorProjection(@Param('id') id: string) {
    return this.knowledge.rebuildVectorProjection(id)
  }

  @Post('store')
  store(@Body() dto: StoreMemoryDto) {
    return this.memory.store(dto)
  }

  @Post('search')
  @HttpCode(200)
  search(@Body() dto: SearchMemoryDto) {
    return this.memory.search(dto)
  }

  @Get('documents')
  @ApiQuery({ name: 'projectId', required: true })
  @ApiQuery({ name: 'class', required: false, enum: ['inbox', 'working', 'consolidated', 'archive'] })
  @ApiQuery({ name: 'type',  required: false, enum: ['decision', 'lesson', 'pattern', 'constraint', 'assumption'] })
  list(
    @Query('projectId') projectId: string,
    @Query('class') memoryClass?: MemoryClass,
    @Query('type')  memoryType?: MemoryType,
  ) {
    return this.memory.list(projectId, memoryClass, memoryType)
  }

  @Get('stats')
  @ApiQuery({ name: 'projectId', required: true })
  stats(@Query('projectId') projectId: string) {
    return this.memory.stats(projectId)
  }

  @Delete('documents/:id')
  @HttpCode(204)
  delete(@Param('id') id: string) {
    return this.memory.delete(id)
  }

  @Patch(':id/class')
  @ApiQuery({ name: 'projectId', required: true })
  updateClass(
    @Param('id') id: string,
    @Query('projectId') projectId: string,
    @Body() dto: UpdateClassDto,
  ) {
    return this.memory.updateClass(id, projectId, dto.memoryClass)
  }
}
