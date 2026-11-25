import { Controller, Get, Param, Query } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { ProjectFilesService } from './project-files.service'

/**
 * Leitura do checkout do projeto (item 3). Só GET: nada aqui escreve. Autenticação pelo guard
 * global (pessoa na web ou o token de serviço do MCP).
 */
@ApiTags('project-files')
@Controller('projects/:id/files')
export class ProjectFilesController {
  constructor(private readonly files: ProjectFilesService) {}

  @Get()
  @ApiOperation({ summary: 'Lista os arquivos do checkout do projeto (git-aware; segredo marcado pelo nome)' })
  listar(@Param('id') id: string, @Query('path') path?: string) {
    return this.files.listar(id, path)
  }

  @Get('content')
  @ApiOperation({ summary: 'Lê um arquivo do checkout (caminho relativo; segredo recusado; inexistente = existe:false)' })
  ler(@Param('id') id: string, @Query('path') path?: string) {
    return this.files.ler(id, path)
  }
}
