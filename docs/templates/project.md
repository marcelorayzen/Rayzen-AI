# [NOME DO PROJETO] — Documentação do Projeto

> **Doc viva.** Atualizada a cada decisão relevante.  
> **Seções obrigatórias antes de codar:** Spec, Stack, Roadmap Fase 1.  
> **Seções que crescem com o projeto:** Diary, Goal Graph, ADRs.

---

## 1. SPEC — O que estamos construindo

### Problema
<!-- Em 1-3 parágrafos: qual dor existe, quem sente, por que importa agora. -->

### Solução
<!-- Como o projeto resolve o problema. Não é uma lista de features — é a proposta de valor. -->

### Usuários / Personas

| Persona | Quem é | Dor principal | O que espera do produto |
|---|---|---|---|
| | | | |

### Escopo do MVP

**Inclui:**
- [ ] [feature essencial 1]
- [ ] [feature essencial 2]
- [ ] [feature essencial 3]

**Explicitamente fora:**
- [ ] [o que não entra no MVP e por quê]
- [ ] [feature tentadora mas que fica para depois]

### Critérios de sucesso do MVP

> O MVP está pronto quando:
> 1. [critério mensurável e verificável]
> 2. [critério mensurável e verificável]
> 3. [critério mensurável e verificável]

---

## 2. ARQUITETURA

### Visão geral do sistema

```
[Diagrama ASCII do sistema]

Exemplo:
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Browser   │────▶│   API       │────▶│   Database  │
│   (Next.js) │     │   (NestJS)  │     │   (Postgres)│
└─────────────┘     └─────────────┘     └─────────────┘
```

### Componentes

| Componente | Tecnologia | Porta | Responsabilidade |
|---|---|---|---|
| | | | |
| | | | |

### Modelo de dados (principais entidades)

```
[Diagrama ER simplificado ou lista de entidades]

Entidade: [Nome]
  - id: uuid PK
  - [campo]: [tipo]  # [descrição]
  - created_at: timestamp
```

### Fluxos críticos

**[Nome do fluxo — ex: Autenticação]:**
```
1. Usuário → [ação]
2. [Sistema] → [o que acontece]
3. [Resposta]
```

**[Nome do fluxo — ex: Processamento de pedido]:**
```
1. ...
```

### Decisões técnicas (ADRs)

| # | Decisão | Escolha | Alternativas consideradas | Motivo |
|---|---|---|---|---|
| 001 | | | | |
| 002 | | | | |

---

## 3. ROADMAP

> Cada fase tem um critério de done explícito. Só avança quando o critério estiver satisfeito.

### Fase 1 — [Nome: ex: MVP Core]

**Objetivo:** [uma frase]

**O que implementar:**
- [ ] [item 1]
- [ ] [item 2]
- [ ] [item 3]

**Critério de done:**
> [Descrição em 1-2 frases do que "pronto" significa de forma verificável]

---

### Fase 2 — [Nome]

**Objetivo:** [uma frase]

**O que implementar:**
- [ ] [item 1]
- [ ] [item 2]

**Critério de done:**
> [...]

---

### Fase 3 — [Nome]

**Objetivo:** [uma frase]

**O que implementar:**
- [ ] [item 1]

**Critério de done:**
> [...]

---

### Backlog (sem fase definida)

- [ ] [feature futura]
- [ ] [melhoria técnica]
- [ ] [integração]

---

## 4. GOAL GRAPH (Rayzen)

> Seção usada pelo Rayzen AI para orientar o Gap Analysis e o Next Best Action.  
> Preencher ao criar o projeto no Rayzen e atualizar a cada nova fase.

### Meta atual

**Título:** [o que queremos alcançar]  
**Prazo:** [data]  
**Status:** [ ] ativa  [ ] pausada  [ ] concluída

### Critérios de sucesso

- [ ] [critério 1 — mensurável]
- [ ] [critério 2 — mensurável]
- [ ] [critério 3 — mensurável]

### KPIs

| Métrica | Meta | Atual | Unidade |
|---|---|---|---|
| [ex: usuários ativos] | | | |
| [ex: tempo de resposta P95] | | | |
| [ex: cobertura de testes] | | | |

### Estado atual do projeto (ProjectState)

**Objetivo:** [o que estamos fazendo agora]  
**Stage:** [ ] discovery  [ ] building  [ ] testing  [ ] shipping  [ ] stable  

**Milestones:**
| ID | Título | Status |
|---|---|---|
| M1 | | [ ] pending  [ ] active  [ ] done |
| M2 | | [ ] pending  [ ] active  [ ] done |

**Blockers ativos:**
- [ ] [blocker 1]

**Próximos passos:**
- [ ] [próxima ação concreta]

---

## 5. ENGINEERING STANDARDS

### Padrões de código

**Formatação:** [prettier / eslint / black / etc.]  
**Nomenclatura:**
- Arquivos: `[kebab-case / PascalCase / snake_case]`
- Variáveis: `[camelCase / snake_case]`
- Constantes: `[UPPER_SNAKE_CASE]`
- Componentes: `[PascalCase]`

**Estrutura de módulo/feature:**
```
[feature]/
├── [feature].controller.ts   # entrada HTTP
├── [feature].service.ts      # lógica de negócio
├── [feature].module.ts       # wiring
├── [feature].dto.ts          # tipos de entrada
└── __tests__/
    └── [feature].spec.ts
```

### Checklist de PR

Antes de abrir um PR:
- [ ] `pnpm typecheck` passa sem erros
- [ ] `pnpm lint` passa sem warnings
- [ ] `pnpm test` passa com cobertura mínima
- [ ] Variáveis de ambiente novas documentadas no `.env.example`
- [ ] Migrations novas foram testadas em banco limpo
- [ ] Sem `console.log` esquecido
- [ ] Sem `TODO` sem issue linkada

### Padrões de commit

```
feat: [descrição curta]     # nova feature
fix: [descrição curta]      # bug fix
refactor: [descrição curta] # refactor sem mudança de comportamento
docs: [descrição curta]     # documentação
test: [descrição curta]     # testes
chore: [descrição curta]    # infra, deps, config
```

---

## 6. DIARY — Log de decisões e problemas

> **Regra:** qualquer decisão não-óbvia ou problema resolvido entra aqui.  
> **Formato:** data · contexto · decisão/solução · motivo · lição aprendida.

---

### [AAAA-MM-DD] — [Título curto da decisão ou problema]

**Contexto:**  
<!-- O que estava acontecendo, qual era o estado antes -->

**Decisão / Solução:**  
<!-- O que foi decidido ou feito -->

**Motivo:**  
<!-- Por que esta escolha e não outra -->

**Alternativas descartadas:**  
<!-- O que foi considerado e por que foi descartado -->

**Lição:**  
<!-- O que aprender para não repetir ou para reaplicar -->

---

### [AAAA-MM-DD] — [Título]

...

---

## 7. QA / GOVERNANÇA

> Preencher se o projeto tem processo formal de QA ou governança de dados.

### Estratégia de testes

| Tipo | Framework | O que cobre | Onde fica |
|---|---|---|---|
| Unit | | | |
| Integração | | | |
| E2E | | | |
| Performance | | | |

### Critérios de qualidade

- Cobertura mínima: [__]% functions / [__]% branches
- Performance: [P95 < X ms para endpoint Y]
- Acessibilidade: [WCAG AA / não aplicável]
- Segurança: [OWASP Top 10 revisado / não aplicável]

### Processo de release

1. [ ] Branch `feature/*` → PR → review
2. [ ] CI passa (typecheck + lint + tests)
3. [ ] Deploy em staging → smoke test manual
4. [ ] Aprovação → merge em `main`
5. [ ] Deploy automático em produção

### Governança de dados (se aplicável)

- **Dados sensíveis:** [o que é considerado sensível neste projeto]
- **Retenção:** [por quanto tempo cada tipo de dado é mantido]
- **Acesso:** [quem acessa o quê]
- **LGPD/GDPR:** [como o projeto lida com dados pessoais]

---

## 8. ONBOARDING — Setup em máquina nova

### 8.1 Setup do projeto

```bash
# 1. Clonar
git clone [url]
cd [repo]

# 2. Instalar dependências
[comando]

# 3. Configurar variáveis de ambiente
cp .env.example .env
# editar .env com valores reais

# 4. Banco de dados
[comando para criar DB]
[comando para migrations]
[comando para seed, se existir]

# 5. Rodar em desenvolvimento
[comando]
```

**Checklist de "funcionando":**
- [ ] [verificação 1 — ex: "acessar localhost:3000 e ver a tela inicial"]
- [ ] [verificação 2 — ex: "criar um usuário de teste e fazer login"]
- [ ] [verificação 3 — ex: "rodar os testes e ver todos passando"]

---

### 8.2 Setup Rayzen AI

> Siga esta seção para integrar o projeto ao Rayzen AI (hook, MCP, Brain).
> Pré-requisito: API do Rayzen acessível na VPS e projeto criado no painel.

#### Passo 1 — Criar o projeto no Rayzen

1. Acesse https://rayzen-web.vercel.app
2. Clique no `+` ao lado do seletor de projetos → nome: **[NOME DO PROJETO]**
3. Copie o **projectId** gerado (visível na URL ou no painel do projeto)

#### Passo 2 — Configurar o hook do Claude Code

Edite `apps/agent/src/hooks/hook.config.mjs` no repositório rayzen-ai:

```js
export default {
  apiUrl: 'http://<VPS_IP>:3101', // API atual do Rayzen na VPS
  apiToken: '<jwt-token>',               // gerar via POST /auth/login
  projectId: '',  // vazio = detecção automática pelo nome do repo git
}
```

O hook detecta o projeto automaticamente pelo `repoSlug` do repositório git aberto no VS Code — sem precisar atualizar o `projectId` ao trocar de projeto.

**Pré-requisito:** o `repoSlug` deste projeto no Rayzen deve bater com o nome do repositório git (ex: pasta `selenium-tests` → repoSlug `selenium-tests`). Projetos criados via `jarvis:create_project_folder template=rayzen` já têm isso configurado.

#### Passo 3 — Configurar MCP (opcional mas recomendado)

Edite `.claude/settings.json` nesta pasta:

```json
{
  "mcpServers": {
    "rayzen": {
      "command": "node",
      "args": ["<CAMINHO_RAYZEN_AI>/apps/agent/dist/mcp-server.js"],
      "env": {
        "AGENT_API_URL": "http://<VPS_IP>:3101",
        "AGENT_TOKEN": "<agent-token>",
        "PROJECT_ID": "<id-do-projeto>"
      }
    }
  }
}
```

Com MCP ativo, o Claude consulta estado, memória e eventos do projeto diretamente.

#### Passo 4 — Indexar fontes no Brain

No painel Rayzen → aba **Brain** → selecione o projeto e indexe:
- **GitHub**: URL do repositório → indexa código e README
- **Arquivos**: specs, ADRs, documentação técnica
- **Notion**: páginas relevantes do projeto

#### Passo 5 — Verificar integração

Faça qualquer edição no VS Code e verifique se o evento aparece no painel **Atividade** do projeto no Rayzen. Se não aparecer:

| Sintoma | Verificar |
|---|---|
| Nenhum evento chega | `apiUrl` e `apiToken` no `hook.config.mjs`; conectividade com a VPS |
| Eventos de outro projeto | `projectId` errado no `hook.config.mjs` |
| MCP não conecta | `AGENT_API_URL` e `PROJECT_ID` no `.claude/settings.json` |
| Claude inventa sobre o projeto | Brain não indexado — refaça o Passo 4 |

#### Agent no PC de trabalho

O Agent local continua no seu PC e deve apontar para a API da VPS:

```env
AGENT_API_URL=http://<VPS_IP>:3101
AGENT_TOKEN=<agent-token>
```

Inicie com `agent-start.bat`.
