# [NOME DO PROJETO] — Instruções para Claude Code

> **Como usar este arquivo:** preencha cada seção antes de iniciar o projeto.
> O Claude Code lê este arquivo antes de qualquer tarefa. Quanto mais preciso, menos retrabalho.

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

## Links úteis

- Swagger/Docs da API: [url]
- Design / Figma: [url]
- Board / Issues: [url]
- Staging: [url]
- Monitoramento: [url]
