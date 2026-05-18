import { Injectable, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { readFile, writeFile, mkdir, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { RayzenConfigService } from '../configuration/configuration.service'

const DOC_TYPE_FILENAMES: Record<string, string> = {
  project_state: 'estado-do-projeto.md',
  decisions_log: 'decisoes.md',
  next_actions:  'proximas-acoes.md',
  work_journal:  'diario.md',
  test_evidence: 'evidencias-de-teste.md',
}

export interface SyncResult {
  synced: SyncedFile[]
  conflicts: ConflictFile[]
  deepLinks: Record<string, string>
  vaultName: string
}

interface SyncedFile {
  type: string
  path: string
  status: 'created' | 'updated'
}

interface ConflictFile {
  type: string
  path: string
  vaultModifiedAt: string
  rayzenGeneratedAt: string
}

@Injectable()
export class ObsidianService {

  constructor(private readonly prisma: PrismaService, private rayzenConfig: RayzenConfigService) {}

  async sync(projectId: string, force = false): Promise<SyncResult> {
    const cfg = this.rayzenConfig.getConfig()
    const vaultPath = cfg.obsidian?.vaultPath
    const vaultName = cfg.obsidian?.vaultName ?? 'vault'

    if (!vaultPath) {
      throw new BadRequestException(
        'Vault path não configurado. Adicione obsidian.vaultPath em /configuration.',
      )
    }

    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } })
    const docs = await this.prisma.projectDocument.findMany({ where: { projectId } })

    if (docs.length === 0) {
      throw new BadRequestException('Nenhum documento gerado ainda. Use POST /documentation/generate/:projectId primeiro.')
    }

    // Pasta do projeto no vault: Rayzen/<nome-do-projeto>/
    const projectSlug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    const projectFolder = join(vaultPath, 'Rayzen', projectSlug)

    if (!existsSync(projectFolder)) {
      await mkdir(projectFolder, { recursive: true })
    }

    const synced: SyncedFile[] = []
    const conflicts: ConflictFile[] = []
    const deepLinks: Record<string, string> = {}

    // Nota de projeto (índice)
    const indexPath = join(projectFolder, 'README.md')
    const indexContent = this.buildIndexNote(project, docs)
    const indexStatus = existsSync(indexPath) ? 'updated' : 'created'
    await writeFile(indexPath, indexContent, 'utf-8')
    synced.push({ type: 'index', path: indexPath, status: indexStatus })
    deepLinks['index'] = `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(`Rayzen/${projectSlug}/README`)}`

    // Documentos gerados
    for (const doc of docs) {
      const filename = DOC_TYPE_FILENAMES[doc.type] ?? `${doc.type}.md`
      const filePath = join(projectFolder, filename)
      const obsidianFile = `Rayzen/${projectSlug}/${filename.replace('.md', '')}`

      deepLinks[doc.type] = `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(obsidianFile)}`

      if (existsSync(filePath) && !force) {
        // Detectar conflito: arquivo foi modificado no Obsidian após a última geração?
        const fileStat = await stat(filePath)
        const vaultMtime = fileStat.mtime
        const generatedAt = new Date(doc.generatedAt)

        if (vaultMtime > generatedAt) {
          conflicts.push({
            type: doc.type,
            path: filePath,
            vaultModifiedAt: vaultMtime.toISOString(),
            rayzenGeneratedAt: doc.generatedAt.toISOString(),
          })
          continue // não sobrescreve
        }
      }

      const content = this.buildDocNote(project.name, doc.type, doc.content, doc.generatedAt.toISOString())
      const status = existsSync(filePath) ? 'updated' : 'created'
      await writeFile(filePath, content, 'utf-8')
      synced.push({ type: doc.type, path: filePath, status })
    }

    return { synced, conflicts, deepLinks, vaultName }
  }

  private buildIndexNote(
    project: { name: string; description: string | null; goals: string | null; status: string; updatedAt: Date },
    docs: Array<{ type: string; generatedAt: Date }>,
  ): string {
    const now = new Date().toISOString()
    const docList = docs
      .map(d => `- [[${DOC_TYPE_FILENAMES[d.type]?.replace('.md', '') ?? d.type}]]`)
      .join('\n')

    return `---
project: ${project.name}
status: ${project.status}
last_updated: ${now}
source: rayzen-ai
---

# ${project.name}

${project.description ?? ''}

## Objetivos

${project.goals ?? '_Não definido_'}

## Documentação

${docList}
`
  }

  private buildDocNote(projectName: string, type: string, content: string, generatedAt: string): string {
    return `---
project: ${projectName}
doc_type: ${type}
generated_at: ${generatedAt}
source: rayzen-ai
---

${content}
`
  }
}
