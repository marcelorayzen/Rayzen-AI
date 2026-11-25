# [Nome do Projeto] — Instruções para Claude Code

## O que é este projeto

<!-- Descreva em 2-3 frases o propósito do projeto. -->

**Dono:** Marcelo Rayzen
**Repositório:** `github.com/marcelorayzen/[repo-name]`
**Stack:** <!-- ex: Next.js 15 + NestJS + PostgreSQL -->

---

## Setup

```bash
# Instalar dependências
npm install   # ou pnpm install

# Variáveis de ambiente
cp .env.example .env

# Banco de dados
npm run db:migrate

# Desenvolvimento
npm run dev
```

---

## Estrutura

```
[repo-name]/
├── src/
├── docs/
│   ├── architecture.md
│   └── roadmap.md
├── .claude/
│   └── settings.json      # hooks do Claude Code (Rayzen AI)
├── CLAUDE.md
└── .env.example
```

---

## Regras de desenvolvimento

- <!-- ex: TypeScript 100%, sem any explícito -->
- <!-- ex: Commits em português, conventional commits -->
- <!-- ex: Testes obrigatórios para módulos críticos -->

---

## Comandos essenciais

```bash
npm run dev          # servidor de desenvolvimento
npm run build        # build de produção
npm run test         # testes
npm run typecheck    # verificação de tipos
npm run lint         # linting
```

---

## Decisões arquiteturais (ADR)

| # | Decisão | Escolha |
|---|---|---|
| 001 | <!-- ex: Framework backend --> | <!-- ex: NestJS --> |

---

## Links úteis

- <!-- ex: Swagger: http://localhost:3001/docs -->
- <!-- ex: Notion: https://notion.so/... -->
