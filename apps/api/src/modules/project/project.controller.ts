import { Controller, Get, Post, Patch, Delete, Param, Body, Query } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { ProjectService } from './project.service'

@ApiTags('projects')
@Controller('projects')
export class ProjectController {
  constructor(private readonly projects: ProjectService) {}

  @Get()
  @ApiOperation({ summary: 'Listar projetos — ?repoSlug=nome-da-pasta para detectar por pasta' })
  findAll(@Query('repoSlug') repoSlug?: string) {
    return this.projects.findAll(repoSlug)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar projeto por ID' })
  findOne(@Param('id') id: string) {
    return this.projects.findOne(id)
  }

  @Post()
  @ApiOperation({ summary: 'Criar projeto — repoSlug auto-derivado do nome se não informado' })
  create(@Body() body: { name: string; description?: string; goals?: string; repoSlug?: string }) {
    return this.projects.create(body)
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar projeto' })
  update(@Param('id') id: string, @Body() body: { name?: string; description?: string; goals?: string; status?: string; repoSlug?: string }) {
    return this.projects.update(id, body)
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deletar projeto' })
  delete(@Param('id') id: string) {
    return this.projects.delete(id)
  }
}
