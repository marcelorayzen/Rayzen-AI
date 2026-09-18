import * as fs from 'fs'
import * as path from 'path'
import { resolve } from 'path'
import { isUnderSafeRoot } from '../utils/path-guard'

const SCHEMA_CANDIDATES = [
  'prisma/schema.prisma',
  'apps/api/prisma/schema.prisma',
  'packages/db/prisma/schema.prisma',
]

export interface InspectSchemaResult {
  schemaPath: string
  models: ModelInfo[]
  rawSchema: string
  summary: string
}

export interface ModelInfo {
  name: string
  fields: FieldInfo[]
  relations: string[]
}

export interface FieldInfo {
  name: string
  type: string
  modifiers: string
}


function parseModels(schema: string): ModelInfo[] {
  const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/g
  const models: ModelInfo[] = []

  let match: RegExpExecArray | null
  while ((match = modelRegex.exec(schema)) !== null) {
    const name = match[1]
    const body = match[2]
    const fields: FieldInfo[] = []
    const relations: string[] = []

    for (const line of body.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@@')) continue

      const parts = trimmed.split(/\s+/)
      if (parts.length < 2) continue

      const fieldName = parts[0]
      const fieldType = parts[1].replace(/[?[\]]/g, '')
      const modifiers = parts.slice(2).join(' ')

      fields.push({ name: fieldName, type: fieldType, modifiers })

      if (/^[A-Z]/.test(fieldType) && !['String', 'Int', 'Float', 'Boolean', 'DateTime', 'Json', 'Bytes', 'BigInt', 'Decimal'].includes(fieldType)) {
        relations.push(`${fieldName}: ${fieldType}`)
      }
    }

    models.push({ name, fields, relations })
  }

  return models
}

export async function inspectSchema(payload: { projectPath?: string; projectId?: string }): Promise<InspectSchemaResult> {
  let schemaPath: string | null = null

  if (payload.projectPath) {
    const resolved = resolve(payload.projectPath)
    if (!isUnderSafeRoot(resolved)) {
      throw new Error(`Caminho não permitido: ${resolved}`)
    }
    const candidate = path.join(resolved, 'prisma/schema.prisma')
    if (fs.existsSync(candidate)) schemaPath = candidate
  }

  if (!schemaPath) {
    for (const candidate of SCHEMA_CANDIDATES) {
      const abs = path.join('C:\\Projects\\rayzen-ai', candidate)
      if (fs.existsSync(abs)) {
        schemaPath = abs
        break
      }
    }
  }

  if (!schemaPath) {
    throw new Error('schema.prisma não encontrado. Informe o caminho do projeto.')
  }

  const rawSchema = fs.readFileSync(schemaPath, 'utf-8')
  const models = parseModels(rawSchema)

  const modelNames = models.map((m) => m.name)
  const totalFields = models.reduce((acc, m) => acc + m.fields.length, 0)
  const summary = `${models.length} models: ${modelNames.join(', ')}. Total de ${totalFields} campos.`

  // O diff contra o snapshot anterior vivia no /data-quality/schema-diff, que saiu
  // junto com o domínio de governança de dados (extraído para o catalog-guardian).
  // A inspeção do schema em si continua — é útil sozinha e não depende daquilo.
  return {
    schemaPath,
    models,
    rawSchema: rawSchema.slice(0, 4000),
    summary,
  }
}
