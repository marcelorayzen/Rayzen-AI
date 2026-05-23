import { execSync } from 'child_process'
import { resolve, join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import { request } from 'node:http'
import { request as httpsRequest } from 'node:https'

const HOME = process.env.USERPROFILE ?? process.env.HOME ?? ''

const SAFE_ROOTS = [
  join(HOME, 'Desktop', 'Projects'),
  join(HOME, 'Projects'),
  'C:\\Projects',
  'D:\\Projects',
]

export type ProjectTemplate = 'blank' | 'node' | 'nextjs' | 'python' | 'rayzen'

const TEMPLATE_DIRS: Record<ProjectTemplate, string[]> = {
  blank: [],
  node: ['src', 'tests'],
  nextjs: ['app', 'components', 'public'],
  python: ['src', 'tests', 'data'],
  rayzen: ['src', 'tests', 'docs', 'docs/specs', 'docs/adr', '.claude'],
}

function toRepoSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

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

interface SpecData {
  problem: string
  solution: string
  personas: Array<{ name: string; role: string; pain: string; expectation: string }>
  mvpFeatures: string[]
  outOfScope: string[]
  successCriteria: string[]
  stack: Array<{ layer: string; tech: string }>
  decisions: Array<{ decision: string; choice: string; reason: string }>
  phase1Name: string
  phase1Items: string[]
  phase1Criterion: string
  diaryEntry: string
}

async function generateSpecFromBrief(name: string, brief: string): Promise<SpecData | null> {
  const agentUrl = process.env.AGENT_API_URL ?? 'http://localhost:3101'
  // LiteLLM corre na mesma VPS, porta 4100
  const litellmBase = agentUrl.replace(/:3101\/?$/, ':4100')
  const litellmUrl = `${litellmBase}/v1/chat/completions`
  const token = process.env.AGENT_TOKEN ?? ''
  if (!token) return null

  const body = JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `Você é um analista de produto e arquiteto de software. Dado o nome e a ideia de um projeto, gere um JSON de especificação estruturada.

Retorne APENAS JSON válido com esta estrutura exata:
{
  "problem": "descrição do problema em 2-3 frases",
  "solution": "proposta de valor em 2-3 frases",
  "personas": [
    { "name": "Nome da Persona", "role": "cargo/papel", "pain": "dor principal", "expectation": "o que espera do produto" }
  ],
  "mvpFeatures": ["feature 1", "feature 2", "feature 3"],
  "outOfScope": ["o que não entra no MVP"],
  "successCriteria": ["critério mensurável 1", "critério 2", "critério 3"],
  "stack": [
    { "layer": "Frontend", "tech": "tecnologia" },
    { "layer": "Backend", "tech": "tecnologia" },
    { "layer": "Banco de dados", "tech": "tecnologia" }
  ],
  "decisions": [
    { "decision": "escolha técnica", "choice": "o que foi escolhido", "reason": "por quê" }
  ],
  "phase1Name": "Nome da Fase 1",
  "phase1Items": ["item 1", "item 2", "item 3"],
  "phase1Criterion": "critério de done da fase 1 em 1 frase verificável",
  "diaryEntry": "resumo em 2 frases do que é o projeto e por que foi iniciado"
}

Seja específico e técnico. Derive stack e decisões do que estiver descrito no brief. Se stack não for mencionada, sugira a mais adequada para o tipo de projeto.`,
      },
      {
        role: 'user',
        content: `Projeto: ${name}\n\nIdeia/Brief:\n${brief}`,
      },
    ],
    temperature: 0.2,
  })

  return new Promise((resolve_) => {
    const parsed = new URL(litellmUrl)
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
          const json = JSON.parse(data)
          const content = json?.choices?.[0]?.message?.content ?? ''
          const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
          const candidate = (fenced?.[1] ?? content).trim()
          const start = candidate.search(/\{/)
          const end = candidate.lastIndexOf('}')
          if (start >= 0 && end > start) {
            resolve_(JSON.parse(candidate.slice(start, end + 1)) as SpecData)
          } else {
            resolve_(null)
          }
        } catch { resolve_(null) }
      })
    })

    req.on('error', () => resolve_(null))
    req.setTimeout(30000, () => { req.destroy(); resolve_(null) })
    req.write(body)
    req.end()
  })
}

function readTemplateFile(filename: string): string | null {
  try {
    const path = join(process.cwd(), 'docs', 'templates', filename)
    if (existsSync(path)) return readFileSync(path, 'utf8')
  } catch {}
  return null
}

function applyTemplateVars(content: string, vars: Record<string, string>): string {
  return content
    .replace(/\[NOME DO PROJETO\]/g, vars.name)
    .replace(/\[repo\]/g, vars.repoSlug)
    .replace(/github\.com\/\[user\]\/\[repo\]/g, `github.com/user/${vars.repoSlug}`)
    .replace(/\[user\]\/\[repo\]/g, `user/${vars.repoSlug}`)
}

function buildProjectMd(name: string, repoSlug: string, spec: SpecData | null, today: string): string {
  const template = readTemplateFile('project.md')

  if (!spec) {
    // Sem brief — retorna template com nome substituído
    return template
      ? applyTemplateVars(template, { name, repoSlug })
      : `# ${name} — Documentação do Projeto\n\n> Doc viva. Preencha as seções antes de codar.\n`
  }

  // Com brief — monta as seções preenchidas
  const personasTable = spec.personas
    .map(p => `| ${p.name} | ${p.role} | ${p.pain} | ${p.expectation} |`)
    .join('\n')

  const mvpItems = spec.mvpFeatures.map(f => `- [ ] ${f}`).join('\n')
  const outOfScopeItems = spec.outOfScope.map(f => `- [ ] ${f}`).join('\n')
  const criteriaItems = spec.successCriteria.map(c => `> ${c}`).join('\n')

  const stackTable = spec.stack
    .map(s => `| ${s.layer} | ${s.tech} | |`)
    .join('\n')

  const decisionsText = spec.decisions
    .map(d => `- **${d.decision}:** ${d.choice} — ${d.reason}`)
    .join('\n')

  const adrRows = spec.decisions
    .map((d, i) => `| ${String(i + 1).padStart(3, '0')} | ${d.decision} | ${d.choice} | | ${d.reason} |`)
    .join('\n')

  const phase1Items = spec.phase1Items.map(i => `- [ ] ${i}`).join('\n')

  return `# ${name} — Documentação do Projeto

> **Doc viva.** Atualizada a cada decisão relevante.
> **Se existe \`BRIEF.md\` nesta pasta:** leia-o primeiro — ele contém a ideia original. Use-o para preencher as seções em branco abaixo.

---

## 1. SPEC — O que estamos construindo

### Problema

${spec.problem}

### Solução

${spec.solution}

### Usuários / Personas

| Persona | Quem é | Dor principal | O que espera do produto |
|---|---|---|---|
${personasTable}

### Escopo do MVP

**Inclui:**
${mvpItems}

**Explicitamente fora:**
${outOfScopeItems}

### Critérios de sucesso do MVP

> O MVP está pronto quando:
${criteriaItems}

---

## 2. ARQUITETURA

### Visão geral do sistema

\`\`\`
[Diagrama ASCII do sistema — preencher]

Exemplo:
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Browser   │────▶│   API       │────▶│   Database  │
└─────────────┘     └─────────────┘     └─────────────┘
\`\`\`

### Componentes

| Componente | Tecnologia | Porta | Responsabilidade |
|---|---|---|---|
| | | | |

### Modelo de dados (principais entidades)

\`\`\`
[Diagrama ER simplificado — preencher]
\`\`\`

### Fluxos críticos

**[Fluxo principal]:**
\`\`\`
1. ...
\`\`\`

### Decisões técnicas (ADRs)

| # | Decisão | Escolha | Alternativas consideradas | Motivo |
|---|---|---|---|---|
${adrRows}

---

## 3. ROADMAP

### Fase 1 — ${spec.phase1Name}

**Objetivo:** Entregar o MVP funcional.

**O que implementar:**
${phase1Items}

**Critério de done:**
> ${spec.phase1Criterion}

---

### Fase 2 — [Nome]

**Objetivo:** [uma frase]

**O que implementar:**
- [ ] [item]

**Critério de done:**
> [...]

---

### Backlog (sem fase definida)

- [ ] [feature futura]
- [ ] [melhoria técnica]

---

## 4. STACK

| Camada | Tecnologia | Versão |
|---|---|---|
${stackTable}

**Decisões importantes:**
${decisionsText}

---

## 5. GOAL GRAPH (Rayzen)

> Seção usada pelo Rayzen AI para orientar o Gap Analysis e o Next Best Action.

### Meta atual

**Título:** ${spec.phase1Name}
**Prazo:** [data]
**Status:** [ ] ativa  [ ] pausada  [ ] concluída

### Critérios de sucesso

${spec.successCriteria.map(c => `- [ ] ${c}`).join('\n')}

### KPIs

| Métrica | Meta | Atual | Unidade |
|---|---|---|---|
| | | | |

### Estado atual do projeto

**Objetivo:** ${spec.phase1Name}
**Stage:** [x] discovery  [ ] building  [ ] testing  [ ] shipping  [ ] stable

**Milestones:**
| ID | Título | Status |
|---|---|---|
| M1 | Setup inicial | [ ] pending  [x] active  [ ] done |

**Blockers ativos:**
- (nenhum no início)

**Próximos passos:**
${spec.phase1Items.slice(0, 3).map(i => `- [ ] ${i}`).join('\n')}

---

## 6. ENGINEERING STANDARDS

### Padrões de código

**Nomenclatura:**
- Arquivos: \`kebab-case\`
- Variáveis: \`camelCase\`
- Constantes: \`UPPER_SNAKE_CASE\`
- Componentes: \`PascalCase\`

### Checklist de PR

- [ ] Typecheck passa sem erros
- [ ] Lint passa sem warnings
- [ ] Testes passam
- [ ] Variáveis de ambiente novas em \`.env.example\`
- [ ] Sem \`console.log\` esquecido

### Padrões de commit

\`\`\`
feat: nova feature
fix: bug fix
refactor: refactor sem mudança de comportamento
docs: documentação
test: testes
chore: infra, deps, config
\`\`\`

---

## 7. DIARY — Log de decisões e problemas

> **Regra:** qualquer decisão não-óbvia ou problema resolvido entra aqui.
> **Quando registrar:** ao fazer uma escolha técnica não-óbvia, resolver bug difícil, mudar de direção.

---

### ${today} — Projeto criado

**Contexto:**
${spec.diaryEntry}

**Decisão:**
Stack escolhida: ${spec.stack.map(s => s.tech).join(', ')}. Template: rayzen.

**Motivo:**
${spec.decisions[0]?.reason ?? 'Melhor adequação ao tipo de projeto.'}

**Próximos passos:**
Preencher Fase 1, configurar Brain no Rayzen, iniciar desenvolvimento.

---

## 8. QA / GOVERNANÇA

### Estratégia de testes

| Tipo | Framework | O que cobre | Onde fica |
|---|---|---|---|
| Unit | [jest/vitest/pytest] | | tests/ |
| Integração | | | |
| E2E | | | |

### Critérios de qualidade

- Cobertura mínima: 80% functions / 70% branches

---

## 9. ONBOARDING

### Setup do projeto

\`\`\`bash
git clone [url]
cd ${repoSlug}
[instalar dependências]
cp .env.example .env
# editar .env com valores reais
[rodar em dev]
\`\`\`

**Checklist:**
- [ ] App abre sem erros
- [ ] Testes passam
- [ ] Integração com Rayzen funcionando (ver RAYZEN-SETUP.md)
`
}

function buildClaudeMd(name: string, repoSlug: string, projectId: string | undefined): string {
  const template = readTemplateFile('CLAUDE.md')
  const base = template
    ? applyTemplateVars(template, { name, repoSlug })
    : `# ${name} — Instruções para Claude Code\n\n> Se existe \`BRIEF.md\` nesta pasta, leia-o PRIMEIRO.\n`

  return base
    .replace('`github.com/[user]/[repo]`', `\`github.com/user/${repoSlug}\``)
    .replace("projectId: '<id-deste-projeto>',", `projectId: '${projectId ?? ''}',  // ${projectId ? 'preenchido automaticamente' : 'preencher após criar no Rayzen'}`)
}

function buildGitignore(): string {
  return `# Dependências
node_modules/
.pnp
.pnp.js
__pycache__/
*.pyc
.venv/
venv/

# Build
dist/
build/
.next/
out/
target/
*.egg-info/

# Ambiente
.env
.env.local
.env.*.local
!.env.example

# Logs
*.log
npm-debug.log*
yarn-error.log*

# Testes
coverage/
.nyc_output/
htmlcov/

# IDE
.vscode/
!.vscode/extensions.json
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Temp / cache
*.tmp
.cache/
.turbo/
`
}

function buildEnvExample(spec: SpecData | null): string {
  const stackMentionsDb = spec?.stack.some(s =>
    /postgres|mysql|mongo|sqlite|redis/i.test(s.tech)
  )

  let content = `# Copie este arquivo para .env e preencha os valores reais
# .env NÃO deve ser commitado

# App
NODE_ENV=development
PORT=3000

`
  if (stackMentionsDb) {
    content += `# Banco de dados
DATABASE_URL=postgresql://user:password@localhost:5432/dbname

`
  }

  content += `# Auth
JWT_SECRET=

# Integrações (preencher conforme necessário)
# API_KEY=
`
  return content
}

function buildReadme(name: string, spec: SpecData | null, repoSlug: string): string {
  const description = spec?.solution ?? `Projeto ${name}.`
  const stack = spec?.stack.map(s => `${s.layer}: **${s.tech}**`).join(' | ') ?? ''

  return `# ${name}

${description}

${stack ? `## Stack\n\n${stack}\n\n` : ''}\
## Setup

\`\`\`bash
# Clonar
git clone <url>
cd ${repoSlug}

# Instalar dependências
[comando]

# Configurar ambiente
cp .env.example .env

# Rodar
[comando]
\`\`\`

## Documentação

- [docs/project.md](docs/project.md) — Spec, arquitetura, roadmap, diary
- [CLAUDE.md](CLAUDE.md) — Instruções para Claude Code
- [RAYZEN-SETUP.md](RAYZEN-SETUP.md) — Integração com Rayzen AI

---

*Projeto gerenciado com Rayzen AI*
`
}

function buildFirstAdr(spec: SpecData | null, today: string): string {
  if (!spec || spec.decisions.length === 0) return ''

  const d = spec.decisions[0]
  const alternatives = spec.stack
    .slice(1, 3)
    .map(s => `| ${s.tech} | | | Não escolhido |`)
    .join('\n')

  return `# ADR 001 — ${d.decision}

> **Status:** aprovada
> **Data:** ${today} | **Autores:** [nome]

---

## Contexto

${spec.problem}

## Decisão

${d.choice}. ${d.reason}

## Alternativas consideradas

| Alternativa | Prós | Contras | Descartada porque |
|---|---|---|---|
${alternatives || '| [alternativa] | | | |'}
| **${d.choice}** | | | (escolhida) |

## Consequências

**Positivas:**
- Alinhado com o problema a resolver
- ${d.reason}

**Trade-offs aceitos:**
- [preencher conforme o projeto evoluir]

## Critérios de revisão

> Revisar esta decisão se:
> - Requisitos de escala mudarem significativamente
> - A tecnologia escolhida for descontinuada
`
}

export async function createProjectFolder(payload: {
  name: string
  root?: string
  template?: ProjectTemplate
  brief?: string
  openVscode?: boolean
  dryRun?: boolean
}): Promise<{
  path: string
  created: boolean
  dryRun: boolean
  openedVscode: boolean
  projectId?: string
  repoSlug?: string
  filesGenerated?: string[]
}> {
  const root = payload.root ?? join(HOME, 'Desktop', 'Projects')
  const resolved = resolve(root)

  const allowed = SAFE_ROOTS.some((r) => resolved.startsWith(resolve(r)))
  if (!allowed) {
    throw new Error(`Pasta raiz não permitida: ${resolved}`)
  }

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
  for (const sub of TEMPLATE_DIRS[template] ?? []) {
    await mkdir(join(projectPath, sub), { recursive: true })
  }

  const filesGenerated: string[] = []
  const today = new Date().toISOString().slice(0, 10)

  // README básico para todos os templates
  await writeFile(join(projectPath, 'README.md'), `# ${name}\n\nProjeto criado via Rayzen AI.\n`)
  filesGenerated.push('README.md')

  // Template rayzen: estrutura completa de documentação
  if (template === 'rayzen') {
    // 1. Registrar no Rayzen API
    const projectId = await registerInRayzen(name, repoSlug) ?? undefined

    // 2. Gerar spec via LLM se brief foi fornecido
    let spec: SpecData | null = null
    if (payload.brief) {
      spec = await generateSpecFromBrief(name, payload.brief)
    }

    // 3. BRIEF.md — salva a ideia original sempre que brief for fornecido
    if (payload.brief) {
      await writeFile(
        join(projectPath, 'BRIEF.md'),
        `# Brief — ${name}\n\n> Ideia original do projeto. Use este arquivo para preencher a documentação.\n\n---\n\n${payload.brief}\n\n---\n\n*Criado em ${today}*\n`,
      )
      filesGenerated.push('BRIEF.md')
    }

    // 4. CLAUDE.md na raiz do projeto
    await writeFile(
      join(projectPath, 'CLAUDE.md'),
      buildClaudeMd(name, repoSlug, projectId),
    )
    filesGenerated.push('CLAUDE.md')

    // 5. docs/project.md — documentação viva (preenchida pelo LLM se brief disponível)
    await writeFile(
      join(projectPath, 'docs', 'project.md'),
      buildProjectMd(name, repoSlug, spec, today),
    )
    filesGenerated.push('docs/project.md')

    // 6. Gitkeeps para specs e adr
    await writeFile(join(projectPath, 'docs', 'specs', '.gitkeep'), '')
    await writeFile(join(projectPath, 'docs', 'adr', '.gitkeep'), '')
    filesGenerated.push('docs/specs/', 'docs/adr/')

    // 7. Primeiro ADR gerado se spec disponível
    if (spec && spec.decisions.length > 0) {
      const adrContent = buildFirstAdr(spec, today)
      if (adrContent) {
        await writeFile(join(projectPath, 'docs', 'adr', '001-stack-decision.md'), adrContent)
        filesGenerated.push('docs/adr/001-stack-decision.md')
      }
    }

    // 8. .env.example
    await writeFile(join(projectPath, '.env.example'), buildEnvExample(spec))
    filesGenerated.push('.env.example')

    // 9. .gitignore
    await writeFile(join(projectPath, '.gitignore'), buildGitignore())
    filesGenerated.push('.gitignore')

    // 10. README melhorado
    await writeFile(join(projectPath, 'README.md'), buildReadme(name, spec, repoSlug))

    // 11. .claude/settings.json com MCP config
    const rayzenRoot = resolve(join(__dirname, '..', '..', '..', '..', '..'))
    const apiUrl = process.env.AGENT_API_URL ?? 'http://localhost:3101'
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
    filesGenerated.push('.claude/settings.json')

    // 12. docs/templates/blueprint-intake.md — prompt estruturado para importação de planos externos
    const blueprintIntake = readTemplateFile('blueprint-intake.md')
    if (blueprintIntake) {
      await mkdir(join(projectPath, 'docs', 'templates'), { recursive: true })
      await writeFile(join(projectPath, 'docs', 'templates', 'blueprint-intake.md'), blueprintIntake)
      filesGenerated.push('docs/templates/blueprint-intake.md')
    }

    // 13. RAYZEN-SETUP.md
    const setupStatus = projectId
      ? `Projeto registrado automaticamente no Rayzen!\n**projectId:** \`${projectId}\`\n**repoSlug:** \`${repoSlug}\``
      : `Não foi possível registrar automaticamente (API offline?).\nAcesse o painel do Rayzen e crie o projeto com o nome **${name}**.`

    await writeFile(
      join(projectPath, 'RAYZEN-SETUP.md'),
      `# Setup Rayzen AI — ${name}

## Status

${setupStatus}

## Hook — detecção automática de projeto

O hook do Claude Code detecta este projeto automaticamente pelo \`repoSlug: ${repoSlug}\`.
**Não é necessário configurar \`projectId\` no \`hook.config.mjs\`** — basta deixar vazio.

## MCP — acesso ao contexto do projeto

O arquivo \`.claude/settings.json\` já foi gerado.
${projectId ? `O \`PROJECT_ID\` já está preenchido: \`${projectId}\`` : 'Preencha o `PROJECT_ID` após criar o projeto no Rayzen.'}

## Próximos passos

1. Abra esta pasta no VS Code
2. Leia o \`BRIEF.md\` (se existir) e complete \`docs/project.md\`
3. Indexe fontes no Brain: painel Rayzen → aba Brain → GitHub/Arquivos
4. Faça qualquer edição e verifique se o evento aparece no painel Atividade do Rayzen

---
*Gerado automaticamente via jarvis:create_project_folder template=rayzen*
`,
    )
    filesGenerated.push('RAYZEN-SETUP.md')

    // 13. Git init + commit inicial
    try {
      execSync('git init', { cwd: projectPath, stdio: 'ignore' })
      execSync('git add .', { cwd: projectPath, stdio: 'ignore' })
      execSync(`git commit -m "chore: inicializar projeto ${name} via Rayzen AI"`, {
        cwd: projectPath,
        stdio: 'ignore',
        env: { ...process.env, GIT_AUTHOR_NAME: 'Rayzen AI', GIT_COMMITTER_NAME: 'Rayzen AI', GIT_AUTHOR_EMAIL: 'rayzen@local', GIT_COMMITTER_EMAIL: 'rayzen@local' },
      })
      filesGenerated.push('.git (init + commit inicial)')
    } catch { /* git não disponível ou erro no commit — não crítico */ }

    // 14. Abrir no VS Code
    let openedVscode = false
    if (payload.openVscode !== false) {
      try {
        execSync(`code "${projectPath}"`, { stdio: 'ignore' })
        openedVscode = true
      } catch { /* VS Code não no PATH */ }
    }

    return { path: projectPath, created: true, dryRun: false, openedVscode, projectId, repoSlug, filesGenerated }
  }

  // Templates não-rayzen: estrutura simples
  let openedVscode = false
  if (payload.openVscode !== false) {
    try {
      execSync(`code "${projectPath}"`, { stdio: 'ignore' })
      openedVscode = true
    } catch { /* VS Code não no PATH */ }
  }

  return { path: projectPath, created: true, dryRun: false, openedVscode, repoSlug, filesGenerated }
}
