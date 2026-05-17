import { execSync } from 'child_process'
import { resolve, join } from 'path'
import { existsSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import { request } from 'node:http'
import { request as httpsRequest } from 'node:https'

const HOME = process.env.USERPROFILE ?? process.env.HOME ?? ''

const SAFE_ROOTS = [
  HOME + '\\Projects',
  'C:\\Projects',
  'D:\\Projects',
]

export type ProjectTemplate = 'blank' | 'node' | 'nextjs' | 'python' | 'rayzen'

const TEMPLATES: Record<ProjectTemplate, string[]> = {
  blank: [],
  node: ['src', 'tests'],
  nextjs: ['app', 'components', 'public'],
  python: ['src', 'tests', 'data'],
  rayzen: ['src', 'tests', 'docs'],
}

// Deriva repoSlug do nome (igual ao ProjectService da API)
function toRepoSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

// Registra projeto na API Rayzen e retorna o projectId
async function registerInRayzen(name: string, repoSlug: string): Promise<string | null> {
  const apiUrl = process.env.AGENT_API_URL ?? 'http://localhost:3101'
  const token  = process.env.AGENT_TOKEN ?? ''
  if (!token) return null

  return new Promise((resolve_) => {
    const body = JSON.stringify({ name, repoSlug })
    const parsed = new URL(`${apiUrl}/projects`)
    const isHttps = parsed.protocol === 'https:'
    const lib = isHttps ? httpsRequest : request

    const req = lib({
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': `Bearer ${token}`,
      },
    }, (res) => {
      let data = ''
      res.on('data', (d) => { data += d })
      res.on('end', () => {
        try {
          const project = JSON.parse(data)
          resolve_(project?.id ?? null)
        } catch { resolve_(null) }
      })
    })

    req.on('error', () => resolve_(null))
    req.setTimeout(8000, () => { req.destroy(); resolve_(null) })
    req.write(body)
    req.end()
  })
}

export async function createProjectFolder(payload: {
  name: string
  root?: string
  template?: ProjectTemplate
  openVscode?: boolean
  dryRun?: boolean
}): Promise<{
  path: string
  created: boolean
  dryRun: boolean
  openedVscode: boolean
  projectId?: string
  repoSlug?: string
}> {
  const root = payload.root ?? (HOME + '\\Projects')
  const resolved = resolve(root)

  const allowed = SAFE_ROOTS.some((r) => resolved.startsWith(r))
  if (!allowed) {
    throw new Error(`Pasta raiz não permitida: ${resolved}`)
  }

  // Sanitiza nome do projeto
  const name = payload.name.replace(/[^a-zA-Z0-9_\-. ]/g, '').trim()
  if (!name) throw new Error('Nome do projeto inválido')

  const projectPath = join(resolved, name)
  const repoSlug = toRepoSlug(name)

  if (payload.dryRun) {
    return { path: projectPath, created: false, dryRun: true, openedVscode: false, repoSlug }
  }

  if (existsSync(projectPath)) {
    throw new Error(`Projeto já existe: ${projectPath}`)
  }

  // Cria pasta raiz e subpastas do template
  await mkdir(projectPath, { recursive: true })
  const template = payload.template ?? 'blank'
  for (const sub of TEMPLATES[template] ?? []) {
    await mkdir(join(projectPath, sub), { recursive: true })
  }

  // README básico
  await writeFile(
    join(projectPath, 'README.md'),
    `# ${name}\n\nProjeto criado via Rayzen AI.\n`,
  )

  // Template rayzen: registra na API + gera arquivos com projectId real
  let projectId: string | undefined
  if (template === 'rayzen') {
    // Registra no Rayzen e obtém o ID real
    projectId = await registerInRayzen(name, repoSlug) ?? undefined

    const rayzenRoot = resolve(join(__dirname, '..', '..', '..', '..', '..'))
    const apiUrl     = process.env.AGENT_API_URL ?? 'https://<NGROK_URL>'

    await mkdir(join(projectPath, '.claude'), { recursive: true })

    await writeFile(
      join(projectPath, '.claude', 'settings.json'),
      JSON.stringify({
        mcpServers: {
          rayzen: {
            command: 'node',
            args: [join(rayzenRoot, 'apps', 'agent', 'dist', 'mcp-server.js')],
            env: {
              AGENT_API_URL: apiUrl,
              AGENT_TOKEN: process.env.AGENT_TOKEN ?? '<JWT_TOKEN>',
              PROJECT_ID: projectId ?? '<PROJECT_ID>',
            },
          },
        },
      }, null, 2),
    )

    const setupStatus = projectId
      ? `Projeto registrado automaticamente no Rayzen!\n**projectId:** \`${projectId}\`\n**repoSlug:** \`${repoSlug}\``
      : `Não foi possível registrar automaticamente (API offline?).\nAcesse https://rayzen-web.vercel.app e crie o projeto com o nome **${name}**.`

    await writeFile(
      join(projectPath, 'RAYZEN-SETUP.md'),
      `# Setup Rayzen AI — ${name}

## Status

${setupStatus}

## Hook — detecção automática de projeto

O hook do Claude Code detecta este projeto automaticamente pelo \`repoSlug: ${repoSlug}\`.
**Não é necessário configurar \`projectId\` no \`hook.config.mjs\`** — basta deixar vazio:

\`\`\`js
// apps/agent/src/hooks/hook.config.mjs no repositório rayzen-ai
export default {
  apiUrl: 'https://<ngrok-url>',
  apiToken: '<jwt-token>',
  projectId: '',  // vazio = auto-detect pelo nome do repo git
}
\`\`\`

## MCP — acesso ao contexto do projeto

O arquivo \`.claude/settings.json\` já foi gerado com os valores corretos.
${projectId ? `O \`PROJECT_ID\` já está preenchido: \`${projectId}\`` : 'Preencha o `PROJECT_ID` após criar o projeto no Rayzen.'}

Verifique se o caminho do \`mcp-server.js\` e o \`AGENT_TOKEN\` estão corretos.

## Brain — indexar fontes de conhecimento

No painel Rayzen → aba **Brain** → selecione **${name}** e indexe:
- GitHub: URL do repositório
- Arquivos: specs, ADRs, documentação técnica

## Verificação

1. Abra esta pasta no VS Code
2. Faça qualquer edição
3. Verifique se o evento aparece no painel **Atividade** do projeto no Rayzen

---
*Gerado automaticamente via jarvis:create_project_folder template=rayzen*
`,
    )
  }

  // Abre no VS Code se solicitado
  let openedVscode = false
  if (payload.openVscode !== false) {
    try {
      execSync(`code "${projectPath}"`, { stdio: 'ignore' })
      openedVscode = true
    } catch { /* VS Code não instalado ou não no PATH */ }
  }

  return { path: projectPath, created: true, dryRun: false, openedVscode, projectId, repoSlug }
}
