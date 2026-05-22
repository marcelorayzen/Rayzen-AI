import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import * as http from 'http'
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
  changes?: SchemaChangeSummary
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

export interface SchemaChangeSummary {
  modelsAdded: string[]
  modelsRemoved: string[]
  fieldsAdded: Array<{ model: string; field: string }>
  fieldsRemoved: Array<{ model: string; field: string }>
  impactedRules: number
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

function diffModels(prev: ModelInfo[], curr: ModelInfo[]): Omit<SchemaChangeSummary, 'impactedRules'> {
  const prevMap = new Map(prev.map(m => [m.name, m]))
  const currMap = new Map(curr.map(m => [m.name, m]))

  const modelsAdded = curr.filter(m => !prevMap.has(m.name)).map(m => m.name)
  const modelsRemoved = prev.filter(m => !currMap.has(m.name)).map(m => m.name)

  const fieldsAdded: Array<{ model: string; field: string }> = []
  const fieldsRemoved: Array<{ model: string; field: string }> = []

  for (const [name, currModel] of currMap) {
    const prevModel = prevMap.get(name)
    if (!prevModel) continue
    const prevFields = new Set(prevModel.fields.map(f => f.name))
    const currFields = new Set(currModel.fields.map(f => f.name))
    for (const f of currFields) if (!prevFields.has(f)) fieldsAdded.push({ model: name, field: f })
    for (const f of prevFields) if (!currFields.has(f)) fieldsRemoved.push({ model: name, field: f })
  }

  return { modelsAdded, modelsRemoved, fieldsAdded, fieldsRemoved }
}

async function apiPost(url: string, token: string, body: object): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const isHttps = parsed.protocol === 'https:'
    const lib = isHttps ? https : http
    const data = JSON.stringify(body)
    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        Authorization: `Bearer ${token}`,
      },
    }, res => {
      let out = ''
      res.on('data', d => { out += d })
      res.on('end', () => { try { resolve(JSON.parse(out)) } catch { resolve(out) } })
    })
    req.on('error', reject)
    req.setTimeout(6000, () => { req.destroy(); reject(new Error('timeout')) })
    req.write(data)
    req.end()
  })
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

  const result: InspectSchemaResult = {
    schemaPath,
    models,
    rawSchema: rawSchema.slice(0, 4000),
    summary,
  }

  // Detect schema changes and notify API
  const apiUrl = process.env.AGENT_API_URL ?? 'http://localhost:3101'
  const token = process.env.AGENT_TOKEN ?? ''

  try {
    const changeResult = await apiPost(
      `${apiUrl}/data-quality/schema-diff`,
      token,
      { models, projectId: payload.projectId ?? null },
    ) as { changes?: SchemaChangeSummary }

    if (changeResult?.changes) {
      result.changes = changeResult.changes
    }
  } catch {
    // Non-fatal — schema diff is best-effort
  }

  return result
}
