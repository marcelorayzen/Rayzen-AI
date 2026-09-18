---
capitulo: 1
titulo: "Gênese — v0.1.0"
periodo: "2026-04-01 a 2026-04-02"
fontes:
  commits: ["f396396", "1685dc8"]
  docs: ["docs/diary.md"]
confianca: "alta"
---

# Capítulo 1 — Gênese

## O primeiro commit

`f396396` — *"feat: v0.1.0 — plataforma Rayzen AI completa"* — 2026-04-02. É o marco zero do repositório. Um dia depois, `1685dc8` já é um redesign do README com badges e ícones — sinal de que, desde o início, o projeto tratou a própria documentação como parte da entrega, não como um apêndice.

Mas o trabalho real de 2026-04-01, capturado em `docs/diary.md`, mostra que "v0.1.0" não nasceu do zero conceitualmente — nasceu de uma sequência de decisões técnicas tomadas sob restrição, quase todas no mesmo dia.

## Os pivots fundacionais

Quatro decisões, todas datadas 2026-04-01 no diário, definiram a espinha da stack antes mesmo do primeiro commit:

**LLM: OpenAI → Groq.** Contexto: "quota da OpenAI esgotada durante o desenvolvimento inicial". A decisão foi migrar para Groq (gratuito) via LiteLLM como proxy — os nomes de modelo no código (`gpt-4o`, `gpt-4o-mini`) continuaram iguais; só o `config.yaml` do LiteLLM passou a apontar para `meta-llama/llama-4-scout-17b-16e-instruct`. Impacto no código da API: zero. Essa é a primeira evidência de um padrão que se repete no resto da história do projeto — o LiteLLM como camada de indireção que absorve trocas de provedor sem tocar lógica de negócio.

**Embeddings: OpenAI → Jina AI.** Mesma pressão de quota. `jina-embeddings-v3` no tier gratuito, mas com uma consequência real: dimensão 1024 em vez das 1536 da OpenAI, exigindo alterar o schema do banco (`vector(1024)`). Diferente da troca de LLM, essa não foi de impacto zero — quem quisesse voltar para embeddings OpenAI precisaria rodar migration + `ALTER TABLE` manualmente (o Prisma não gera esse tipo de migração sozinho, registrado depois na seção de aprendizados do próprio diário).

**TTS: a única exceção ao proxy.** O LiteLLM não suportava corretamente o endpoint de TTS do Groq (áudio binário), então `tts.service.ts` foi escrito para chamar o Groq diretamente com `GROQ_API_KEY` — documentado explicitamente como a única chamada do sistema que não passa pelo proxy. Essa exceção sobreviveu como regra formal ("LLM sempre via LiteLLM — nunca direto para OpenAI/Groq") justamente porque foi identificada e documentada, não escondida.

**Auth: JWT com senha única.** Havia um ADR em aberto (referenciado no diário como "ADR-007", nunca materializado como arquivo) debatendo Auth.js vs Clerk vs JWT custom. A decisão foi pragmática: como ferramenta de uso pessoal, OAuth seria over-engineering. Senha única em `ADMIN_PASSWORD`, JWT de 30 dias. A revisão futura ficou registrada como condicional: "se o projeto for multi-usuário, migrar para Auth.js com Google OAuth" — condição que, até o capítulo 7 deste livro, ainda não se cumpriu.

No dia seguinte (2026-04-02), veio a quinta decisão: um **sistema de configuração central** (`rayzen.config.json` + `ConfigPanelModule` + página `/settings`), motivado por o projeto já ter crescido com personalizações espalhadas em código. A decisão foi additive — zero impacto no funcionamento existente — mas sinalizou a intenção, desde o dia 2, de tornar o Rayzen reutilizável por outros usuários sem exigir que tocassem TypeScript.

## O MVP entregue

O `docs/diary.md` documenta o "Histórico de versões" do v0.1.0 (2026-04-01) com uma lista de features que já formavam um produto completo em um único dia de desenvolvimento intenso:

- Chat com streaming SSE (efeito typewriter)
- Classificador de intent com 5 módulos (`jarvis`, `brain`, `doc`, `content`, `system`)
- Brain — memória semântica via pgvector + Jina embeddings, com indexação automática de informações pessoais durante a conversa
- Brain — importação via GitHub (repos + READMEs), arquivo PDF/TXT, URL
- Jarvis — execução de tarefas locais (abrir app, listar diretório, info do sistema) — o embrião do que viria a ser a whitelist do agent
- Doc Engine — geração de PDF via Puppeteer
- Content Studio — posts, threads, artigos, calendário editorial
- TTS via Groq Orpheus, STT via Groq Whisper com auto-send
- Login por senha com JWT de 30 dias, rate limiting de 120 req/min

Stack definida no dia 1: NestJS 10 + Fastify no backend, Next.js 16 App Router no frontend, Groq via LiteLLM, PostgreSQL + pgvector, Redis + BullMQ para filas.

## Os primeiros problemas — e por que importam

Cinco problemas foram resolvidos e documentados no mesmo 2026-04-01, todos com causa raiz identificada (não só sintoma):

1. **Navegador abrindo em loop infinito** — dezenas de janelas Chrome abrindo sozinhas ao rodar `pnpm dev:agent`. Causa: `AgentBridgeService.getPending()` retornava jobs BullMQ em estado `waiting` sem filtrar por `data.status`; o job de `open_app` ficava preso como `waiting` na fila mesmo após ser marcado `done` nos dados, e a cada poll de 3s o agent reexecutava. A lição documentada — "`job.update()` não muda o estado interno da fila, só os dados; estado BullMQ e `data.status` são independentes" — é o tipo de conhecimento operacional que só se aprende depurando, e que reaparece implicitamente em toda a arquitetura de filas do projeto daí em diante.
2. **Memória automática não indexando** — "meu nome é Marcelo" não virava documento no Brain. Duas causas empilhadas: o classificador LLM rotulava afirmações pessoais como módulo `brain` (busca) em vez de `system` (afirmação), e o `catch {}` silencioso em `extractAndIndex()` escondia qualquer erro real. Esse padrão — falha silenciosa mascarando um bug de classificação — reaparece, em forma mais grave, no bugchain de junho (capítulo 5).
3. **Dimensão do pgvector incompatível** — consequência direta do pivot Jina: schema criado para `vector(1536)`, Jina devolvendo `vector(1024)`. Resolvido com `ALTER TABLE` manual.
4. **`@fastify/multipart` incompatível** — versão 9 quebrava upload de áudio para STT contra Fastify 4; downgrade para v8.
5. **Streaming exibindo tudo de uma vez** — o efeito typewriter não aparecia porque o React batcha atualizações de estado; a correção foi uma fila de tokens com `setTimeout` de 18ms entre cada um, forçando renders individuais.

## Legado deste capítulo

As regras de governança que abrem o `docs/diary.md` — nenhuma ação do PC Agent fora da whitelist, path traversal sempre bloqueado, `dryRun: true` obrigatório antes de ação destrutiva, sem `exec()`/`spawn()` livre, TypeScript 100% sem `any` explícito — não foram adicionadas depois de um incidente. Estavam escritas desde o dia 1, antes de existir superfície de ataque real para justificá-las. É a mesma disciplina que, meses depois, o Guardian (capítulo 6) viria a automatizar e os ADRs de role-policy (capítulo 5) viriam a auditar.
