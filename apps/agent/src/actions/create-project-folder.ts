import { resolve, join, dirname } from 'path'
import { existsSync, readFileSync } from 'fs'
import { mkdir, writeFile, cp, rm } from 'fs/promises'
import { request } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { executarPrograma, ambientePadrao } from '../exec/executar-programa'
import { isUnderSafeRoot } from '../utils/path-guard'
import { RetratoDoGit, retratoDoGit } from './retrato-do-git'
import { validarArquivosDoPlano, gitignoreDoPadrao, arquivosGeradosDoPadrao, type ArquivoDoPlano } from './padrao-rayzen'

/**
 * Migrado na Fase 1: `git init/add/commit` e `code "<path>"` montavam string de comando
 * com `name`/`repoSlug` interpolados dentro — a Fase 0 marcou isso como "a verificar" e
 * nunca fechou. `name` vem de payload (nome de projeto digitado por alguém) e pode conter
 * praticamente qualquer coisa.
 *
 * Extraído em duas funções porque os templates `rayzen` e `extract_from_client` tinham o
 * MESMO bloco quase duplicado — é a mesma classe de defeito do token commitado
 * (`escreverIntegracaoRayzen`, já unificado antes): dois blocos quase iguais divergem
 * cedo ou tarde porque só um deles é lembrado quando algo muda.
 */
export async function gitInitCommit(cwd: string, mensagemDeCommit: string): Promise<boolean> {
  // Nunca `{ ...process.env, ... }`: o commit não precisa de mais nada do ambiente do
  // agent além do que o git exige para rodar.
  const env = {
    ...ambientePadrao(),
    GIT_AUTHOR_NAME: 'Rayzen AI', GIT_COMMITTER_NAME: 'Rayzen AI',
    GIT_AUTHOR_EMAIL: 'rayzen@local', GIT_COMMITTER_EMAIL: 'rayzen@local',
  }
  const opts = { cwd, env, timeoutMs: 15_000 }
  try {
    if ((await executarPrograma('executavel', 'git', ['init'], opts)).code !== 0) return false
    if ((await executarPrograma('executavel', 'git', ['add', '.'], opts)).code !== 0) return false
    // `mensagemDeCommit` como UM elemento do argv — nunca dentro de string de comando.
    const commit = await executarPrograma('executavel', 'git', ['commit', '-m', mensagemDeCommit], opts)
    return commit.code === 0
  } catch {
    return false
  }
}

/** `code.cmd` no Windows lança `Code.exe` (Electron) com `ELECTRON_RUN_AS_NODE=1` — não é
 * `node.exe` como `pnpm`/`npx`. `executarPrograma` resolve isso pela estratégia `entrypointJs`. */
export async function abrirVscode(caminho: string): Promise<boolean> {
  try {
    const r = await executarPrograma('entrypointJs', 'code', [caminho], {
      cwd: process.cwd(), env: ambientePadrao(), timeoutMs: 15_000,
    })
    return r.code === 0
  } catch {
    return false
  }
}

const HOME = process.env.USERPROFILE ?? process.env.HOME ?? ''

// Raiz do monorepo rayzen-ai, ancorada na localização deste arquivo (robusto a cwd).
// Em src/actions (dev) e dist/actions (build) são 4 níveis acima: actions → (dist|src) → agent → apps → rayzen-ai.
const RAYZEN_ROOT = resolve(join(__dirname, '..', '..', '..', '..'))

export type ProjectTemplate = 'blank' | 'node' | 'nextjs' | 'python' | 'rayzen' | 'extract_from_client' | 'padrao-rayzen'

const TEMPLATE_DIRS: Record<ProjectTemplate, string[]> = {
  // Diretórios vêm dos caminhos dos arquivos do plano; nada é criado vazio.
  'padrao-rayzen': [],
  blank: [],
  node: ['src', 'tests'],
  nextjs: ['app', 'components', 'public'],
  python: ['src', 'tests', 'data'],
  rayzen: ['src', 'tests', 'docs', 'docs/specs', 'docs/adr', '.claude'],
  extract_from_client: ['docs', 'docs/specs', 'docs/adr', '.claude'],
}

function toRepoSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

/** Uma chamada HTTP à api V1, devolvendo status e corpo — nunca lançando. */
function chamarApi(
  metodo: 'GET' | 'POST' | 'PATCH',
  caminho: string,
  corpo?: unknown,
): Promise<{ status: number; body: unknown } | null> {
  const apiUrl = process.env.AGENT_API_URL ?? 'http://localhost:3101'
  const token  = process.env.AGENT_TOKEN ?? ''
  if (!token) return Promise.resolve(null)

  return new Promise((resolve_) => {
    const payload = corpo === undefined ? undefined : JSON.stringify(corpo)
    const parsed = new URL(`${apiUrl.replace(/\/+$/, '')}${caminho}`)
    const isHttps = parsed.protocol === 'https:'
    const lib = isHttps ? httpsRequest : request

    const req = lib({
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`,
      method: metodo,
      headers: {
        ...(payload === undefined ? {} : {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        }),
        'Authorization': `Bearer ${token}`,
      },
    }, (res) => {
      let data = ''
      res.on('data', (d) => { data += d })
      res.on('end', () => {
        let body: unknown = null
        try { body = data ? JSON.parse(data) : null } catch { body = data }
        resolve_({ status: res.statusCode ?? 0, body })
      })
    })

    req.on('error', () => resolve_(null))
    req.setTimeout(8000, () => { req.destroy(); resolve_(null) })
    if (payload !== undefined) req.write(payload)
    req.end()
  })
}

export type RegistroDeProjeto = {
  projectId: string
  /** `false` quando o projeto já existia e foi reconhecido em vez de recriado. */
  criado: boolean
}

/** Leitura pura — é o que a prévia pode fazer sem causar o efeito que ela existe para prever. */
async function consultarProjetoPorSlug(
  repoSlug: string,
): Promise<{ id: string; checkoutPath?: string | null } | null> {
  const busca = await chamarApi('GET', `/projects?repoSlug=${encodeURIComponent(repoSlug)}`)
  const lista = Array.isArray(busca?.body)
    ? busca?.body as Array<{ id?: string; checkoutPath?: string | null }>
    : []
  const achado = lista.find((p) => typeof p.id === 'string')
  return achado?.id ? { id: achado.id, checkoutPath: achado.checkoutPath } : null
}

/**
 * Garante que o projeto existe no catálogo, e devolve o id — mesmo quando ele já existia.
 *
 * ── O defeito que isto conserta ─────────────────────────────────────────────
 * `repoSlug` é `@unique`, então a segunda tentativa de registrar o mesmo projeto recebe
 * **HTTP 409** (o `PrismaExceptionFilter` traduz o P2002). A versão anterior lia só
 * `project?.id` do corpo, não achava id nenhum num corpo de erro, e devolvia `null` — que o
 * chamador interpreta como "API offline". O gerador então escrevia no `RAYZEN-SETUP.md`
 * *"Não foi possível registrar automaticamente (API offline?)"* e deixava o `projectId` vazio
 * no `CLAUDE.md`, **mentindo sobre um projeto que existe e cujo id era conhecível**.
 *
 * Não é hipótese: é o caminho de toda retentativa depois que o registro já aconteceu, que é
 * exatamente o que a Fase 4 precisa que seja repetível.
 *
 * ── Por que 409 e ausência de rede levam a lugares diferentes ───────────────
 * "Já existe" é uma resposta; "não respondeu" é a falta de uma. Colapsar as duas é o defeito
 * de origem. Só a segunda continua devolvendo `null`.
 */
async function garantirProjetoNoRayzen(
  name: string,
  repoSlug: string,
  checkoutPath: string,
): Promise<RegistroDeProjeto | null> {
  const criacao = await chamarApi('POST', '/projects', { name, repoSlug, checkoutPath })
  if (!criacao) return null

  const corpo = criacao.body as { id?: string } | null
  if (criacao.status < 300 && corpo?.id) return { projectId: corpo.id, criado: true }
  if (criacao.status !== 409) return null

  // Conflito: o projeto já está registrado. O id é conhecível — basta perguntar.
  const busca = await chamarApi('GET', `/projects?repoSlug=${encodeURIComponent(repoSlug)}`)
  const lista = Array.isArray(busca?.body) ? busca?.body as Array<{ id?: string; checkoutPath?: string | null }> : []
  const existente = lista.find((p) => typeof p.id === 'string')
  if (!existente?.id) return null

  // Reconcilia o catálogo com o disco: um registro criado antes deste campo existir não sabe
  // onde o checkout está. Só preenche quando está vazio — sobrescrever apagaria o caminho de
  // uma máquina que talvez não seja esta.
  if (!existente.checkoutPath) {
    await chamarApi('PATCH', `/projects/${existente.id}`, { checkoutPath })
  }
  return { projectId: existente.id, criado: false }
}

/**
 * O que o `RAYZEN-SETUP.md` afirma sobre o registro — três casos, não dois.
 *
 * "Criado", "já existia" e "não consegui perguntar" pedem leituras diferentes de quem abre o
 * arquivo. O texto anterior colapsava os dois últimos em *"API offline?"*, então a retentativa
 * mais comum do mundo — registrar de novo um projeto já registrado — gerava documentação que
 * mandava criar à mão um projeto que estava lá.
 */
export function statusDoRegistro(
  registro: RegistroDeProjeto | null,
  name: string,
  repoSlug: string,
  checkoutPath: string,
): string {
  if (!registro) {
    return `Não foi possível falar com a API do Rayzen agora (sem resposta).\n`
      + `Confira no painel se o projeto **${name}** existe antes de criar outro.`
  }
  const cabecalho = registro.criado
    ? 'Projeto registrado automaticamente no Rayzen!'
    : 'Projeto **já estava registrado** no Rayzen — reaproveitado, não duplicado.'
  return `${cabecalho}\n**projectId:** \`${registro.projectId}\`\n`
    + `**repoSlug:** \`${repoSlug}\`\n**checkout:** \`${checkoutPath}\``
}

export interface SpecData {
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

function readTemplateFile(filename: string): string | null {
  try {
    const path = join(RAYZEN_ROOT, 'docs', 'templates', filename)
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

/**
 * Escreve a integração com o Rayzen no projeto novo: `.mcp.json` na raiz e os
 * hooks em `.claude/settings.json`.
 *
 * Três defeitos consertados aqui em 2026-08-17, todos observados em projeto real:
 *
 * 1. **`mcpServers` morava em `.claude/settings.json`**, que o Claude Code não lê
 *    para isso — servidor de MCP de projeto se declara em `.mcp.json`. Prova: dos
 *    5 projetos na máquina, só o `rayzen-ai` tinha `.mcp.json`, e era o único com
 *    `mcpServers` registrado no `~/.claude.json`. Nos outros as tools `rayzen_*`
 *    simplesmente não existiam, sem erro nenhum.
 *
 * 2. **O `AGENT_TOKEN` era gravado dentro do arquivo** — e o gerador faz
 *    `git init && git add . && git commit` logo abaixo. O token entrava no
 *    primeiro commit do repositório. Foi assim que o token do Rayzen foi parar no
 *    histórico do Rayzen Commerce Platform (commit de bootstrap). Não é preciso:
 *    `loadConfig()` do `rayzen-mcp.mjs` cai em `hook.config.mjs` quando a env não
 *    existe, que é exatamente como o próprio `rayzen-ai` funciona.
 *
 * 3. **`PROJECT_ID` vinha fixado**, contra a regra do projeto e contra o próprio
 *    `RAYZEN-SETUP.md` gerado, que dizia "não é necessário configurar projectId"
 *    duas linhas antes de anunciar o `PROJECT_ID` preenchido. Fixar reativa o
 *    fallback legado do MCP e é a origem do incidente da Urna (blueprint gravado
 *    no projeto errado). A resolução correta é pelo repositório do cwd.
 *
 * Aponta para o `.mjs` em `src/`, não para `dist/`: o MCP e os hooks rodam sem
 * build, então um `dist` desatualizado não tem como quebrar projeto novo.
 */
export async function escreverIntegracaoRayzen(projectPath: string): Promise<string[]> {
  const mcp   = join(RAYZEN_ROOT, 'apps', 'agent', 'src', 'mcp', 'rayzen-mcp.mjs')
  const hook  = join(RAYZEN_ROOT, 'apps', 'agent', 'src', 'hooks', 'rayzen-hook.mjs')
  const ctx   = join(RAYZEN_ROOT, 'apps', 'agent', 'src', 'hooks', 'rayzen-context-hook.mjs')
  const rodar = (script: string) => ({ type: 'command', command: `node "${script}"` })

  await mkdir(join(projectPath, '.claude'), { recursive: true })

  await writeFile(
    join(projectPath, '.mcp.json'),
    `${JSON.stringify({ mcpServers: { rayzen: { command: 'node', args: [mcp] } } }, null, 2)}\n`,
  )

  await writeFile(
    join(projectPath, '.claude', 'settings.json'),
    `${JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ matcher: '', hooks: [rodar(ctx)] }],
        PostToolUse:      [{ matcher: '', hooks: [rodar(hook)] }],
        Stop:             [{ matcher: '', hooks: [rodar(hook)] }],
      },
    }, null, 2)}\n`,
  )

  return ['.mcp.json', '.claude/settings.json']
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
  spec?: SpecData
  /** Caminho do repo fonte (template=extract_from_client). */
  sourceRepo?: string
  /** template=padrao-rayzen: conteúdo APROVADO do plano, escrito como está (item 7.6). */
  arquivos?: ArquivoDoPlano[]
  openVscode?: boolean
  dryRun?: boolean
}): Promise<{
  path: string
  created: boolean
  dryRun: boolean
  openedVscode: boolean
  /** true quando a pasta já existia e a chamada só reconciliou catálogo e disco. */
  reconciled?: boolean
  /** Retrato do git no caminho de reconciliação — o mesmo formato que a prévia produz. */
  git?: RetratoDoGit
  projectId?: string
  repoSlug?: string
  filesGenerated?: string[]
  /** true quando o projeto precisa de uma sessão supervisionada de extração logo após. */
  needsExtractionSession?: boolean
  /** Só em `dryRun`: o que aconteceria se a chamada fosse executada de verdade. */
  previa?: {
    template: ProjectTemplate
    pastaJaExiste: boolean
    /** Retrato do git: do checkout quando ele existe, da raiz quando ainda vai ser criado. */
    git: RetratoDoGit
    acao: 'criar' | 'reconciliar'
    subpastas: string[]
    projetoJaRegistrado: { id: string; checkoutPath: string | null } | null
    vaiRodarGitInitCommit: boolean
    vaiAbrirVscode: boolean
    /** template=padrao-rayzen: os caminhos que serão escritos, já validados. */
    arquivos?: string[]
  }
}> {
  const root = payload.root ?? join(HOME, 'Desktop', 'Projects')
  const resolved = resolve(root)

  if (!isUnderSafeRoot(resolved)) {
    throw new Error(`Pasta raiz não permitida: ${resolved}`)
  }

  const name = payload.name.replace(/[^a-zA-Z0-9_\-. ]/g, '').trim()
  if (!name) throw new Error('Nome do projeto inválido')

  const projectPath = join(resolved, name)
  const repoSlug = toRepoSlug(name)

  // ── A prévia responde "o que vai acontecer", não só "onde" ─────────────────
  //
  // `create_project_folder` passou a ser risco `medium` em 24/09 (ela cria pasta, roda
  // `git init/add/commit` e abre o editor), e a regra da casa manda prever antes de executar
  // risco médio. A prévia anterior devolvia caminho e slug — nada que permitisse conferir se
  // já existe pasta, se o projeto já está registrado, ou se um commit inicial vai acontecer.
  //
  // Só entra aqui o que é derivável sem duplicar o caminho de criação: a lista de arquivos
  // gerados mora naquele fluxo, e repeti-la aqui criaria duas listas que divergem na primeira
  // mudança. Diretório de template vem de `TEMPLATE_DIRS`, que já é fonte única.
  if (payload.dryRun) {
    const template = payload.template ?? 'blank'
    // Plano inválido recusa JÁ na prévia: nunca chega a aprovação com cara de executável.
    const doPlano = template === 'padrao-rayzen' ? validarArquivosDoPlano(payload.arquivos) : null
    const jaExiste = existsSync(projectPath)
    const jaRegistrado = await consultarProjetoPorSlug(repoSlug)
    // ── Onde o git é medido depende do que vai acontecer ─────────────────────
    //
    // Vai RECONCILIAR: o retrato é do próprio checkout, que é o que a execução vai encontrar.
    //
    // Vai CRIAR: a pasta ainda não existe, então mede-se a RAIZ — e é lá que mora a única
    // pergunta de git capaz de tornar o efeito errado. Se a raiz já está dentro de um
    // repositório, o `git init` criaria um repositório aninhado. `existsSync('.git')` é cego
    // para isso, porque a raiz do repositório pode estar vários níveis acima.
    const git = await retratoDoGit(jaExiste ? projectPath : resolved)
    return {
      path: projectPath,
      created: false,
      dryRun: true,
      openedVscode: false,
      repoSlug,
      previa: {
        template,
        pastaJaExiste: jaExiste,
        git,
        // Pasta existente significa RECONCILIAR: nada é reescrito.
        acao: jaExiste ? 'reconciliar' : 'criar',
        subpastas: TEMPLATE_DIRS[template] ?? [],
        projetoJaRegistrado: jaRegistrado ? { id: jaRegistrado.id, checkoutPath: jaRegistrado.checkoutPath ?? null } : null,
        vaiRodarGitInitCommit: !jaExiste && (template === 'rayzen' || template === 'extract_from_client' || template === 'padrao-rayzen'),
        vaiAbrirVscode: payload.openVscode !== false,
        ...(doPlano ? { arquivos: [...doPlano, ...arquivosGeradosDoPadrao(doPlano)].map((a) => a.path) } : {}),
      },
    }
  }

  // ── Repetição converge, não falha ──────────────────────────────────────────
  //
  // Lançar aqui tornava a ação irrepetível: uma tentativa que criou a pasta e morreu antes de
  // registrar não tinha como ser retomada — a segunda chamada só sabia dizer "já existe". A
  // Fase 4 pede o contrário ("repetição não duplica pasta ou registro"), e o broker da Fase 1
  // reentrega tarefa cujo efeito ficou incerto, então esse caminho é o caminho normal.
  //
  // Reconciliar NÃO é sobrescrever: nenhum arquivo é reescrito. O que se faz é garantir o
  // registro no catálogo e relatar o que se encontrou — sobrescrever apagaria o trabalho feito
  // no projeto desde a primeira execução, que é pior que o defeito original.
  if (existsSync(projectPath)) {
    const registro = await garantirProjetoNoRayzen(name, repoSlug, projectPath)
    let openedVscode = false
    if (payload.openVscode !== false) openedVscode = await abrirVscode(projectPath)
    return {
      path: projectPath,
      created: false,
      reconciled: true,
      dryRun: false,
      openedVscode,
      projectId: registro?.projectId,
      repoSlug,
      // O MESMO retrato que a prévia produz, para que a reconciliação compare duas medições
      // equivalentes. Um booleano `temGit` não serviria: ele não distingue "não é repo" de
      // "não consegui olhar", e não diz nada sobre branch, HEAD ou trabalho pendente.
      git: await retratoDoGit(projectPath),
    }
  }

  const template = payload.template ?? 'blank'

  // ── padrao-rayzen: grava o plano aprovado, e só ele (item 7.6) ──────────────
  if (template === 'padrao-rayzen') {
    // Valida ANTES de criar a pasta: plano recusado não deixa diretório pela metade.
    const arquivos = validarArquivosDoPlano(payload.arquivos)
    await mkdir(projectPath, { recursive: true })
    const escritos: string[] = []
    for (const a of arquivos) {
      const destino = join(projectPath, a.path)
      await mkdir(dirname(destino), { recursive: true })
      const conteudo = a.path === '.gitignore' ? gitignoreDoPadrao(a.conteudo) : a.conteudo
      await writeFile(destino, conteudo)
      escritos.push(a.path)
    }
    if (!arquivos.some((a) => a.path === '.gitignore')) {
      await writeFile(join(projectPath, '.gitignore'), gitignoreDoPadrao())
      escritos.push('.gitignore')
    }
    for (const extra of arquivosGeradosDoPadrao(arquivos)) {
      await writeFile(join(projectPath, extra.path), extra.conteudo)
      escritos.push(extra.path)
    }
    const registro = await garantirProjetoNoRayzen(name, repoSlug, projectPath)
    escritos.push(...await escreverIntegracaoRayzen(projectPath))
    if (await gitInitCommit(projectPath, `chore: inicializar ${name} no padrão Rayzen`)) {
      escritos.push('.git (init + commit inicial)')
    }
    const openedVscode = payload.openVscode !== false ? await abrirVscode(projectPath) : false
    return {
      path: projectPath, created: true, dryRun: false, openedVscode,
      projectId: registro?.projectId, repoSlug, filesGenerated: escritos,
    }
  }

  // Cria pasta raiz e subpastas do template
  await mkdir(projectPath, { recursive: true })
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
    const registro = await garantirProjetoNoRayzen(name, repoSlug, projectPath)
    const projectId = registro?.projectId

    // 2. Spec: só a fornecida (Blueprint já revisado). A geração a partir do brief, que chamava
    //    `/v2/discovery/spec-from-brief`, saiu na S5.5 (20/11) junto com o discovery da V2:
    //    gerar spec por LLM é o tipo de geração que já inventou decisão aqui (ver padrao-rayzen.ts).
    //    Sem spec, o brief continua salvo no BRIEF.md abaixo.
    const spec: SpecData | null = payload.spec ?? null

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

    // 11. Integração com o Rayzen: .mcp.json + hooks (sem segredo, sem projectId fixado)
    filesGenerated.push(...await escreverIntegracaoRayzen(projectPath))

    // 12. docs/templates/blueprint-intake.md — prompt estruturado para importação de planos externos
    const blueprintIntake = readTemplateFile('blueprint-intake.md')
    if (blueprintIntake) {
      await mkdir(join(projectPath, 'docs', 'templates'), { recursive: true })
      await writeFile(join(projectPath, 'docs', 'templates', 'blueprint-intake.md'), blueprintIntake)
      filesGenerated.push('docs/templates/blueprint-intake.md')
    }

    // 13. RAYZEN-SETUP.md
    // O texto diz o que de fato aconteceu. A versão anterior tinha um caso só para "sem id", e
    // por isso anunciava "API offline?" também quando o projeto JÁ ESTAVA registrado — a
    // situação normal de toda retentativa.
    const setupStatus = statusDoRegistro(registro, name, repoSlug, projectPath)

    await writeFile(
      join(projectPath, 'RAYZEN-SETUP.md'),
      `# Setup Rayzen AI — ${name}

## Status

${setupStatus}

## Hook — detecção automática de projeto

O hook do Claude Code detecta este projeto automaticamente pelo \`repoSlug: ${repoSlug}\`.
**Não é necessário configurar \`projectId\` no \`hook.config.mjs\`** — basta deixar vazio.

## MCP — acesso ao contexto do projeto

O \`.mcp.json\` na raiz já foi gerado e é lá que o Claude Code procura servidores MCP
de projeto — **não** em \`.claude/settings.json\`, que carrega só os hooks.

Ele **não** guarda token nem \`PROJECT_ID\`, de propósito:

- o token vem do \`hook.config.mjs\` do Rayzen, então nunca entra no histórico deste
  repositório (este arquivo é commitado no \`git init\` logo após ser gerado);
- o projeto é resolvido pelo repositório do diretório atual, igual ao hook. Fixar o
  id faria toda escrita cair sempre no mesmo projeto, independente de onde você está.

Se as tools \`rayzen_*\` não aparecerem, feche e reabra a pasta no VS Code — o
\`.mcp.json\` é lido na abertura da sessão.

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
    if (await gitInitCommit(projectPath, `chore: inicializar projeto ${name} via Rayzen AI`)) {
      filesGenerated.push('.git (init + commit inicial)')
    }

    // 14. Abrir no VS Code
    let openedVscode = false
    if (payload.openVscode !== false) {
      openedVscode = await abrirVscode(projectPath)
    }

    return { path: projectPath, created: true, dryRun: false, openedVscode, projectId, repoSlug, filesGenerated }
  }

  // Template extract_from_client: copia código-fonte do repo existente e inicializa como produto novo.
  if (template === 'extract_from_client') {
    if (!payload.sourceRepo) throw new Error('sourceRepo é obrigatório para template extract_from_client')

    const sourceResolved = resolve(payload.sourceRepo)
    if (!existsSync(sourceResolved)) throw new Error(`sourceRepo não encontrado: ${sourceResolved}`)

    const registro = await garantirProjetoNoRayzen(name, repoSlug, projectPath)
    const projectId = registro?.projectId

    // Copia todo o conteúdo do repo fonte, excluindo .git
    await cp(sourceResolved, projectPath, {
      recursive: true,
      filter: (src) => !src.replace(/\\/g, '/').includes('/.git/') && !src.endsWith('/.git'),
    })
    filesGenerated.push(`(código fonte copiado de ${sourceResolved})`)

    // Remove .git do destino se veio junto. `rd`/`rm` são comandos internos do shell — não
    // executáveis de verdade, então nem entravam no escopo de `executarPrograma()` (que
    // precisa de um programa real no PATH). O `fs.rm` do próprio Node já faz isso sem
    // nenhum processo-filho, em vez de tentar as duas formas de shell por SO na sorte.
    await rm(join(projectPath, '.git'), { recursive: true, force: true })

    // Garante subpastas de documentação
    for (const sub of TEMPLATE_DIRS.extract_from_client) {
      await mkdir(join(projectPath, sub), { recursive: true })
    }

    // CLAUDE.md + RAYZEN-SETUP.md
    await writeFile(join(projectPath, 'CLAUDE.md'), buildClaudeMd(name, repoSlug, projectId))
    filesGenerated.push('CLAUDE.md')

    const setupStatus = statusDoRegistro(registro, name, repoSlug, projectPath)

    await writeFile(
      join(projectPath, 'RAYZEN-SETUP.md'),
      `# Setup Rayzen AI — ${name}\n\n## Status\n\n${setupStatus}\n\n` +
      `## Origem\n\nEste projeto foi extraído de \`${sourceResolved}\` usando o template **extract_from_client**.\n` +
      `A extração (limpeza de identidade, multi-tenant, modularização) é realizada por sessão supervisionada.\n\n` +
      `---\n*Gerado automaticamente via jarvis:create_project_folder template=extract_from_client*\n`,
    )
    filesGenerated.push('RAYZEN-SETUP.md')

    // Integração com o Rayzen: mesma função do template rayzen, para os dois não
    // divergirem de novo — o defeito do token commitado existia nos dois blocos.
    filesGenerated.push(...await escreverIntegracaoRayzen(projectPath))

    // Git init + commit inicial (bootstrap from source)
    const mensagemBootstrap = `chore: bootstrap from ${repoSlug.replace('rayzen-', '')} architecture`
    if (await gitInitCommit(projectPath, mensagemBootstrap)) {
      filesGenerated.push('.git (init + commit bootstrap)')
    }

    let openedVscode = false
    if (payload.openVscode !== false) {
      openedVscode = await abrirVscode(projectPath)
    }

    return { path: projectPath, created: true, dryRun: false, openedVscode, projectId, repoSlug, filesGenerated, needsExtractionSession: true }
  }

  // Templates não-rayzen: estrutura simples
  let openedVscode = false
  if (payload.openVscode !== false) {
    openedVscode = await abrirVscode(projectPath)
  }

  return { path: projectPath, created: true, dryRun: false, openedVscode, repoSlug, filesGenerated }
}
