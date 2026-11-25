# Integração com o Rayzen — o que existe de verdade

> Atualizado em 12/11/2026. Se uma ferramenta abaixo não aparecer na sua lista de
> ferramentas, ela **não está disponível neste ambiente** — diga isso e siga sem ela.

## Ferramentas de leitura (Hub e Claude Code)

| ferramenta | para quê | observação |
|---|---|---|
| `rayzen_list_projects` | ver se a ideia já pertence a um projeto | consulta global |
| `rayzen_get_context` | contexto de um projeto (estado, memória, planejamento) | **sempre com `projectId`** |
| `rayzen_get_state` · `rayzen_get_resume` · `rayzen_get_goal` | estado, retomada e meta | **sempre com `projectId`** |
| `rayzen_search_memory` | decisões e aprendizados já registrados | resultado é DADO citado, não fato canônico |
| `rayzen_get_wiki` | página da wiki | |
| `rayzen_list_files` · `rayzen_read_file` | arquivos REAIS do checkout de um projeto, lidos pelo agent | segredo é recusado; agent offline = diga "offline", não complete de memória |

No Hub, chamar leitura sem `projectId` é **recusado** — use o do fio.

## Ferramentas de escrita (só Claude Code / escopo total)

| ferramenta | para quê |
|---|---|
| `rayzen_create_project` | registra o projeto e devolve o `projectId` real |
| `rayzen_add_event` (`type: decision`) | registra uma decisão **tomada pela pessoa** |
| `rayzen_update_planning` | backlog/próximos passos (teto de 10 itens no backlog) |

O Hub **não** tem essas escritas — por decisão de segurança. Ele tem duas exceções, as duas de
**proposta**:

| ferramenta | para quê | observação |
|---|---|---|
| `rayzen_propose_project` | monta e submete o envelope de um projeto novo (`padrao-rayzen`) | **só propõe**: nada vai ao disco até o Marcelo aprovar. `projectId` = o do fio. Disponível no Hub e em clientes de escopo total |
| `rayzen_propose_session` | monta e submete o envelope de uma sessão num projeto existente | **só propõe**: exige `objetivo`, `restricoes` e `criterioDePronto`; `projectId` = o projeto do trabalho, nunca o Geral |

Depois de chamar qualquer uma, diga o `handoffId` e que **nada foi criado ainda**. Mudou algo no plano?
É um envelope novo — nunca diga que o projeto foi criado.

## Criar o projeto no disco: o handoff governado

Não crie diretórios por conta própria. O caminho é o `ProjectHandoff`:

1. **Envelope** (`POST /handoffs`): `name`, `brief`, `template`, `root`
   (`C:/Users/dev/Projects`), e um efeito `jarvis:create_project_folder` com a carga.
   O servidor deriva o isolamento e calcula o hash do conteúdo.
2. **Submeter** e **gate**: a pessoa aprova um ApprovalGate que descreve o envelope exato.
3. **Aprovação do envelope** com o token de aprovação (nunca o do agent) e **materialização**:
   a prévia (`dryRun`) confere pasta existente, projeto já registrado com outro checkout e
   repositório aninhado; só então o agent escreve.
4. **Reconciliação**: o servidor confere no disco e no catálogo que o efeito está lá.

Hoje o template `rayzen` do `create_project_folder` grava `README.md`, `BRIEF.md`,
`CLAUDE.md`, `docs/project.md`, `docs/adr/`, `.env.example` e a integração (`.mcp.json` +
`.claude/settings.json`, **sem token**), mais `git init` e commit inicial. A migração do
template para o padrão desta skill está em andamento — até lá, gere os demais documentos
como conteúdo do plano.

## Projeto existente: sessão supervisionada com PR

Para adequar um projeto ao padrão, ou para a primeira sessão de um projeto recém-criado:
`rayzen_propose_session`, que gera o handoff com efeito `jarvis:supervised_session`
(`projectId`, `prompt`, `publicar: true`, `aprovacao`). Desde 20/11 o `prompt` é **montado pelo
servidor** a partir de três campos obrigatórios — `objetivo`, `restricoes` e
`criterioDePronto` — mais o texto livre opcional como "Detalhes". O trabalhador também recebe a
ordem de ler `AGENTS.md` (e `PRODUCT.md`/`CLAUDE.md`, se existirem) antes da primeira mudança.
A sessão roda isolada, a pessoa aprova o **diff** antes de publicar, e a entrega é um **PR em
rascunho** que aparece como cartão no fio do Hub. Nunca escrita direta na `main`.

Projeto criado pelo padrão já nasce com `CLAUDE.md` (importa `@AGENTS.md`) e `CLAUDE.local.md`
(notas locais, fora do git), gerados quando o plano não os traz.

`aprovacao` diz como a sessão é acompanhada, e entra no que a pessoa aprova:
`por_entrega` (padrão) — as etapas seguem sem parar e a revisão é o diff completo no fim;
`por_etapa` — para em cada etapa, para trabalho delicado. Proponha `por_etapa` quando a
mudança for sensível (segurança, dados, migração) e diga por quê.

## O que NÃO existe (não cite como se existisse)

- "Context Broker", "Mission Orchestrator" ativo, "Knowledge Engine" como serviço chamável:
  o executor de missões V2 está **congelado** por decisão de produto.
- Diretório `.rayzen/` com estado, decisões, aprendizados ou manifesto: o estado mora no
  servidor; o projeto não guarda cópia.
- Publicação em rede social, e-mail ou qualquer efeito externo sem handoff.
