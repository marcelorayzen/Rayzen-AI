<div align="center">

<img src="apps/web/public/rayzen-icon.svg" width="112" height="112" alt="Rayzen AI" />

<h1>Rayzen AI</h1>

<p><strong>Criado e mantido por <a href="https://github.com/marcelorayzen">Marcelo Rayzen</a></strong></p>

<p>Plataforma pessoal de IA com memória de projetos, contexto governado e execução assistida no desktop e no servidor.</p>

<p>
<img src="https://img.shields.io/badge/licen%C3%A7a-Apache--2.0-blue" alt="Licença Apache-2.0" />
<img src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white" alt="TypeScript" />
<img src="https://img.shields.io/badge/NestJS-11-e0234e?logo=nestjs&logoColor=white" alt="NestJS 11" />
<img src="https://img.shields.io/badge/Next.js-16-000000?logo=next.js&logoColor=white" alt="Next.js 16" />
</p>

</div>

> **English:** Rayzen AI is a personal AI platform by Marcelo Rayzen: project memory, governed
> context, and assisted execution on the desktop and on a home server. This repository is a public
> mirror of the source code, licensed under Apache-2.0. Production infrastructure and operational
> documentation are not included.

---

## Sobre este repositório

Este é o **espelho público do código** do Rayzen AI. O desenvolvimento acontece num repositório
privado, e este espelho é atualizado a partir dele com histórico próprio.

**Está aqui:** o código dos apps (`apps/`), os tipos compartilhados (`packages/`), os prompts e
skills do núcleo (`core/`), os testes, os scripts de desenvolvimento e a configuração de build.

**Não está aqui:** a infraestrutura de produção (Docker Compose, proxy, túnel, configuração do
LiteLLM), a documentação operacional e histórica, os blueprints de design e as configurações
locais de agentes de código. Por isso, o espelho não sobe a pilha inteira com um comando; veja
[Rodando localmente](#rodando-localmente).

## O que o Rayzen AI faz

- **Memória e contexto de projeto.** Eventos de trabalho, decisões e documentos ficam ligados a
  um projeto, com busca semântica (pgvector) e um pacote de contexto que registra o que foi
  servido a cada consumidor.
- **Hub de conversa.** Uma interface web única para conversar sobre os projetos, com fios por
  escopo e voz no compositor.
- **Execução governada.** Um agent no desktop e outro no servidor executam só ações de uma
  whitelist tipada, com nível de risco, `dryRun` e aprovação humana para o que é sensível.
- **Integração com o Claude Code.** Hooks e um servidor MCP enviam a atividade da sessão ao
  Rayzen e injetam o estado do projeto em cada pedido.
- **Sensores e invariantes.** Verificações periódicas do próprio sistema (modelos que respondem,
  eventos sem projeto, disco, deploy) com o motivo de cada uma no código.

## Arquitetura

```
apps/
├── api/        NestJS 11 + Fastify — assistente, memória, Hub, automação (schema Postgres public)
├── api-v2/     NestJS 11 — motores de missão, contexto, Guardian e invariantes (schema v2)
├── web/        Next.js (App Router) — o Hub e os painéis
└── agent/      agent desktop/servidor, hooks do Claude Code e servidor MCP
packages/
└── types/      tipos compartilhados
core/           identidade do agente, agentes, serviços e skills em Markdown
scripts/        utilitários de desenvolvimento (catálogo de ações, varredura de segredos, smoke)
```

**Stack:** TypeScript · NestJS 11 · Next.js 16 · PostgreSQL 16 + pgvector · Redis 7 + Bull ·
Prisma 5 · LiteLLM como proxy de modelos · Langfuse para rastreio · Puppeteer e docxtemplater
para documentos.

### Regras de desenvolvimento

- TypeScript em todo o código, sem `any` explícito.
- Toda chamada de modelo passa pelo LiteLLM e se identifica no rastreio; nunca direto ao provedor.
- Cada módulo NestJS tem o próprio system prompt.
- A whitelist do agent (`apps/agent/src/security/whitelist.ts`) é inegociável: ação fora dela é
  rejeitada.
- Path traversal (`../`) é sempre bloqueado; ações de risco médio ou alto rodam primeiro em
  `dryRun`.
- A V2 lê o schema `public` da V1 e nunca escreve nele.
- Identidade é de quem persiste: o modelo nunca escolhe um `id`.

## Rodando localmente

Pré-requisitos: Node 20+, pnpm 10, PostgreSQL 16 com a extensão `pgvector`, Redis 7 e um proxy
LiteLLM com os grupos de modelo que o código usa (`gpt-4o`, `gpt-4o-mini`, `gpt-local`, entre
outros).

```bash
pnpm install
cp .env.example .env              # preencha banco, Redis, LiteLLM e segredos
pnpm --filter api db:generate
pnpm --filter api-v2 db:generate
pnpm dev:api                      # API → :3101
pnpm dev:web                      # Web → :3100
```

Verificação:

```bash
pnpm typecheck
pnpm lint
pnpm test
```

## Contribuindo e segurança

Leia o [CONTRIBUTING.md](CONTRIBUTING.md) antes de abrir um PR. Vulnerabilidades não vão em issue
pública: siga o [SECURITY.md](SECURITY.md).

## Licença e autoria

Copyright 2026 **Marcelo Rayzen**.

Distribuído sob a [Apache License 2.0](LICENSE). Redistribuições e trabalhos derivados devem
manter o arquivo [NOTICE](NOTICE) com a atribuição ao autor. A licença não concede uso do nome
ou da marca "Rayzen" para promover produtos derivados.
