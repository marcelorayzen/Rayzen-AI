import { execSync } from 'child_process'
import { resolve, join } from 'path'
import { existsSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'

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

  if (payload.dryRun) {
    return { path: projectPath, created: false, dryRun: true, openedVscode: false }
  }

  if (existsSync(projectPath)) {
    throw new Error(`Projeto já existe: ${projectPath}`)
  }

  // Cria pasta raiz
  await mkdir(projectPath, { recursive: true })

  // Cria subpastas do template
  const template = payload.template ?? 'blank'
  const subfolders = TEMPLATES[template] ?? []
  for (const sub of subfolders) {
    await mkdir(join(projectPath, sub), { recursive: true })
  }

  // Cria README.md básico
  await writeFile(
    join(projectPath, 'README.md'),
    `# ${name}\n\nProjeto criado via Rayzen AI.\n`,
  )

  // Template rayzen: cria .claude/settings.json e RAYZEN-SETUP.md
  if (template === 'rayzen') {
    await mkdir(join(projectPath, '.claude'), { recursive: true })

    await writeFile(
      join(projectPath, '.claude', 'settings.json'),
      JSON.stringify({
        mcpServers: {
          rayzen: {
            command: 'node',
            args: ['<CAMINHO_RAYZEN_AI>/apps/agent/dist/mcp-server.js'],
            env: {
              AGENT_API_URL: 'https://<NGROK_URL>',
              AGENT_TOKEN: '<JWT_TOKEN>',
              PROJECT_ID: '<PROJECT_ID>',
            },
          },
        },
      }, null, 2),
    )

    await writeFile(
      join(projectPath, 'RAYZEN-SETUP.md'),
      `# Setup Rayzen AI — ${name}

## Passo 1 — Criar projeto no Rayzen

1. Acesse https://rayzen-web.vercel.app
2. Clique no \`+\` ao lado do seletor de projetos
3. Digite o nome: **${name}**
4. Copie o **projectId** gerado (aparece na URL ou no painel)

## Passo 2 — Configurar o hook

Edite \`apps/agent/src/hooks/hook.config.mjs\` no repositório rayzen-ai:

\`\`\`js
export default {
  apiUrl: 'https://<url-ngrok-atual>',
  apiToken: '<jwt-token>',
  projectId: '<id-copiado-no-passo-1>',
}
\`\`\`

## Passo 3 — Configurar MCP

Edite \`.claude/settings.json\` nesta pasta com os valores corretos:
- \`<CAMINHO_RAYZEN_AI>\`: caminho completo para o repositório rayzen-ai
- \`<NGROK_URL>\`: URL do ngrok ativo no notebook
- \`<JWT_TOKEN>\`: token JWT (veja hook.config.mjs)
- \`<PROJECT_ID>\`: ID copiado no Passo 1

## Passo 4 — Indexar no Brain

No painel Rayzen → aba Brain → selecione este projeto e indexe as fontes:
- GitHub: cole a URL do repositório
- Arquivos: faça upload de docs, specs, etc.

## Verificação

Abra o VS Code nesta pasta, faça uma edição qualquer e verifique se o evento aparece
no painel "Atividade" do projeto no Rayzen (https://rayzen-web.vercel.app).

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

  return { path: projectPath, created: true, dryRun: false, openedVscode }
}
