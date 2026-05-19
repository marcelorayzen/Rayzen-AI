# [NOME DO PROJETO] — Instruções para Claude Code

> **Como usar este arquivo:** preencha cada seção antes de iniciar o projeto.  
> O Claude Code lê este arquivo antes de qualquer tarefa. Quanto mais preciso, menos retrabalho.  
> **Se existe `BRIEF.md` nesta pasta:** leia-o PRIMEIRO. Ele contém a ideia original do projeto — use-o para preencher `docs/project.md` (spec, stack, roadmap) antes de codar qualquer coisa.

---

## O que é este projeto

<!-- O que o projeto faz em 2-3 frases. Quem usa. Qual problema resolve. -->

**Projeto:** [nome]  
**Tipo:** [ ] Web App  [ ] API  [ ] CLI  [ ] Biblioteca  [ ] Mobile  [ ] Automação  
**Dono:** [nome] — [cargo/papel]  
**Repositório:** `github.com/[user]/[repo]`  
**Ambientes:**
- Dev: `http://localhost:[porta]`
- Produção: `https://[domínio]`

---

## Stack

| Camada | Tecnologia | Versão |
|---|---|---|
| Frontend | | |
| Backend | | |
| Banco de dados | | |
| Cache | | |
| Auth | | |
| Deploy | | |
| Testes | | |

**Decisões importantes:**
- <!-- ex: "não usar ORM — queries raw por performance" -->
- <!-- ex: "autenticação via JWT, sem sessions" -->
- <!-- ex: "monorepo com pnpm workspaces" -->

---

## Estrutura do repositório

```
[repo]/
├── [pasta-1]/          # [descrição]
├── [pasta-2]/          # [descrição]
├── docs/               # documentação viva
│   ├── CLAUDE.md       # este arquivo
│   ├── spec.md         # especificação do produto
│   ├── architecture.md # decisões técnicas
│   ├── roadmap.md      # fases e critérios
│   └── diary.md        # log de decisões e problemas
└── [config files]
```

---

## Comandos essenciais

```bash
# Instalar dependências
[comando]

# Desenvolvimento
[comando]

# Testes
[comando]

# Build
[comando]

# Deploy
[comando]

# Banco — migrations
[comando]

# Banco — seed
[comando]
```

---

## Módulos / Componentes principais

| Módulo | Localização | Responsabilidade |
|---|---|---|
| | | |
| | | |
| | | |

---

## Variáveis de ambiente

```bash
# [Grupo - ex: Banco de dados]
[VAR_NAME]=          # [descrição]

# [Grupo - ex: Auth]
[VAR_NAME]=          # [descrição]

# [Grupo - ex: Integrações]
[VAR_NAME]=          # [descrição]
```

**Arquivo de exemplo:** `.env.example` (commitado)  
**Arquivo real:** `.env` (gitignored)

---

## Regras de desenvolvimento

<!-- Preencha as regras que o Claude deve seguir neste projeto. -->

**Linguagem/estilo:**
- [ ] TypeScript estrito — sem `any` explícito
- [ ] Sem comentários óbvios — só comentar o "por quê", nunca o "o quê"
- [ ] Nomenclatura: [camelCase / snake_case / kebab-case]

**Arquitetura:**
- [ ] [regra específica do projeto — ex: "toda lógica de negócio no service, nunca no controller"]
- [ ] [regra — ex: "sem lógica no banco, sem stored procedures"]
- [ ] [regra — ex: "componentes React sem lógica — apenas apresentação"]

**Banco de dados:**
- [ ] [regra — ex: "migrations obrigatórias, nunca alterar schema diretamente"]
- [ ] [regra — ex: "índices para todo campo usado em WHERE ou JOIN"]

**Segurança:**
- [ ] [regra — ex: "validar input na borda, nunca confiar no frontend"]
- [ ] [regra — ex: "sem secrets em código — sempre variáveis de ambiente"]

**Testes:**
- [ ] [regra — ex: "todo endpoint novo precisa de teste de integração"]
- [ ] [regra — ex: "mocks só em unit tests, integração usa banco real"]

**Proibido:**
- [ ] [ex: "não usar setTimeout como solução de race condition"]
- [ ] [ex: "não commitar sem passar no typecheck e lint"]
- [ ] [ex: "não usar force push em main/master"]

---

## Quando criar spec antes de implementar

Criar um documento de spec em `docs/specs/[feature].md` antes de codar quando:
- [ ] A feature muda contrato de API (novos endpoints ou schema)
- [ ] Envolve mais de 3 arquivos novos
- [ ] Tem ambiguidade de comportamento
- [ ] Afeta dados do usuário (delete, migrate, transform)

---

## Contexto de QA / Testes

<!-- Preencha se o projeto tem contexto de QA específico -->

**Framework de testes:** [jest / vitest / pytest / cypress / playwright]  
**Cobertura mínima:** [80%] functions / [70%] branches  
**Tipos de teste usados:**
- [ ] Unit
- [ ] Integração
- [ ] E2E
- [ ] Performance

**Onde ficam os testes:** `[caminho]/`  
**Como rodar:** `[comando]`  
**CI:** [ ] GitHub Actions  [ ] GitLab CI  [ ] Outro: ___

---

## Rayzen AI — Integração

> Esta seção é obrigatória para projetos que usam o Rayzen AI como plataforma de acompanhamento.

### Hook Claude Code

O hook envia cada ação do Claude (Edit, Write, Bash, Read) para a API do Rayzen como evento.

**Arquivo de config:** `apps/agent/src/hooks/hook.config.mjs` (gitignored no rayzen-ai — nunca sobe)

```js
export default {
  apiUrl: 'http://<VPS_IP>:3101', // API atual do Rayzen na VPS
  apiToken: '<jwt-token>',              // gerar via POST /auth/login
  projectId: '<id-deste-projeto>',      // copiar da URL ou painel Rayzen
}
```

**Detecção automática de projeto (recomendado):**

Deixe `projectId` vazio — o hook detecta o projeto pelo nome do repositório git:

```js
export default {
  apiUrl: 'http://<VPS_IP>:3101',
  apiToken: '<jwt-token>',
  projectId: '',  // vazio = auto-detect pelo repoSlug do git remote
}
```

O hook lê `git remote get-url origin`, extrai o nome do repo e consulta `GET /projects?repoSlug=<nome>`. Trocar de projeto = abrir outra pasta no VS Code, sem tocar no config.

**Pré-requisito:** o `repoSlug` do projeto no Rayzen deve bater com o nome do repositório git. Projetos criados via `jarvis:create_project_folder template=rayzen` já têm isso configurado automaticamente.

**Forçar projeto específico:** preencha `projectId` manualmente — útil se o repo git não corresponde ao projeto Rayzen.

### MCP Rayzen

O MCP permite que o Claude consulte estado, memória, eventos e wiki do projeto diretamente.

**Verificar se está ativo:** `.claude/settings.json` deve conter:
```json
{
  "mcpServers": {
    "rayzen": {
      "command": "node",
      "args": ["<caminho-para-rayzen-ai>/apps/agent/dist/mcp-server.js"],
      "env": {
        "AGENT_API_URL": "http://<VPS_IP>:3101",
        "AGENT_TOKEN": "<agent-token>",
        "PROJECT_ID": "<id-deste-projeto>"
      }
    }
  }
}
```

**Ferramentas disponíveis via MCP:**
- `rayzen_get_state` — estado atual do projeto (stage, blockers, decisions)
- `rayzen_get_goal` — meta ativa com critérios de sucesso
- `rayzen_get_events` — atividade recente
- `rayzen_search_memory` — busca semântica no Brain do projeto
- `rayzen_get_wiki` — wiki indexada
- `rayzen_get_resume` — resumo executivo
- `rayzen_checkpoint` — criar checkpoint de sessão
- `rayzen_add_event` — registrar evento manual
- `rayzen_update_planning` — atualizar milestones/blockers/nextSteps

### Papéis dos Agents

| Papel | Onde roda | Exemplos |
|---|---|---|
| `desktop` | PC de trabalho | screenshot, VS Code, clipboard, testes locais, provas visuais |
| `server` | VPS | logs de containers, Docker da stack, restart da API |

`screenshot` pertence ao desktop; logs e status da stack hospedada pertencem ao server.

### Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| Claude inventa coisas sobre o projeto | Brain não indexado ou repoSlug não bate | Indexar fontes no painel Brain; verificar se `repoSlug` do projeto bate com o nome do repo git |
| Eventos vão para o projeto errado | repoSlug de outro projeto bateu antes (cache) | Aguardar 5 min (TTL do cache) ou deletar `%TEMP%\rayzen-slug-cache.json` |
| Hook não envia eventos | API inacessível ou token inválido | Verificar a VPS e atualizar `apiUrl` / `apiToken` no `hook.config.mjs` |
| Hook não detecta o projeto | Pasta sem git remote ou repoSlug não cadastrado | Verificar `git remote get-url origin`; corrigir `repoSlug` via `PATCH /projects/:id` |
| MCP não conecta | `AGENT_API_URL` ou `PROJECT_ID` errado | Verificar `.claude/settings.json` com valores corretos |
| `jarvis:restart_api` falha | API segurando DLL do Prisma | Parar API → `npx prisma generate` → reiniciar |

---

## Links úteis

- Swagger/Docs da API: [url]
- Design / Figma: [url]
- Board / Issues: [url]
- Staging: [url]
- Monitoramento: [url]
- Rayzen AI (produção): http://<VPS_IP>:3100
