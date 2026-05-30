import {
  Controller, Get, Post, Delete, Patch,
  Param, Body, Query, UseGuards, HttpCode,
} from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger'
import { MemoryService } from './memory.service'
import { StoreMemoryDto, SearchMemoryDto, UpdateClassDto, MemoryClass } from './dto/memory.dto'
import { JwtAuthGuard } from '../core/auth.guard'

@ApiTags('memory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('memory')
export class MemoryController {
  constructor(private readonly memory: MemoryService) {}

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
  list(
    @Query('projectId') projectId: string,
    @Query('class') memoryClass?: MemoryClass,
  ) {
    return this.memory.list(projectId, memoryClass)
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
