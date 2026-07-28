---
titulo: "Índice — O Livro do Rayzen AI"
periodo: "2026-04-01 a hoje"
confianca: "alta"
---

# O Livro do Rayzen AI

Este é o registro histórico completo do Rayzen AI, do primeiro commit (`f396396`, 2026-04-02) até o estado atual. Não é um resumo de arquitetura — isso já existe em `docs/architecture.md` e `docs/roadmap.md`, e conta *o que o sistema é hoje*. Este livro conta *como ele chegou lá*: as decisões tomadas, os problemas que apareceram, os pivots, os becos sem saída.

## Por que este livro existe

Ele é a matéria-prima de um projeto futuro — **Golden Dataset: validação de agente sobre catálogo de dados**. Antes de construir um agente que valida qualidade e proveniência de dados, faz sentido aplicar o mesmo padrão à própria história do Rayzen: cada capítulo aqui só afirma o que consegue **sourcear**. Isso segue a mesma disciplina que já está ativa como política do próprio projeto:

> `memory_requires_source`: nós de conhecimento inferidos pelo LLM sem fonte explícita devem ser sinalizados. Exige origin ≥ extracted.

Concretamente, cada capítulo carrega um front-matter com:

```yaml
periodo: "data inicial a data final"
fontes:
  commits: [sha, sha, ...]   # representativos, não exaustivos — ver ANEXO-commits.md para a lista completa
  docs: [caminhos de arquivo]
  memory: [caminhos de arquivo]
confianca: "alta" | "media"
```

- **`confianca: alta`** — o capítulo se apoia em fonte direta e datada: `docs/diary.md`, um ADR, um blueprint, um arquivo de memória com data explícita, ou commits com mensagens autoexplicativas.
- **`confianca: media`** — trecho reconstruído cruzando múltiplas fontes esparsas (tipicamente o período sem diário, 19 de maio em diante), onde a sequência de eventos é inferida a partir de mensagens de commit e memórias que não formam uma narrativa contínua por si só.

Nada aqui foi inventado. Onde a fonte é fraca, o texto diz isso explicitamente em vez de preencher a lacuna com prosa genérica.

## Como as fontes se combinam

| Fonte | Cobertura | Papel |
|---|---|---|
| `docs/diary.md` | 2026-04-01 → 05-18 | Espinha dorsal narrativa dos capítulos 1-3 — decisões e problemas já registrados em primeira pessoa na época |
| `git log` (503 commits) | Todo o período | Lastro cronológico e evidência bruta — ver `ANEXO-commits.md` |
| `blueprints/` (24 docs + VISION.md) | V2, a partir de 05-29 | Design e intenção arquitetural da "Mission Oriented Engineering System" |
| `docs/adr/ADR-001..003` | 06-23 → 06-27 | Decisões formais sobre o drift de role-policy (Fase 0-A) |
| Memória auto-persistida (`memory/*.md`, ~21 arquivos) | 05-19 → 07-24 | Incidentes, bugs e decisões que não viraram documento formal — é a fonte mais densa para o período sem diário |
| `docs/GUARDIAN.md`, `docs/architecture.md`, `docs/roadmap.md` | Estado atual (reescritos 07-02) | Fotografia do "onde chegou", usada para fechar cada capítulo |
| Eventos ao vivo do Rayzen (`rayzen_get_events`) | Só ~3,5 semanas (03-07 → hoje) | Testado durante a pesquisa deste livro — não alcança o nascimento do projeto; usado só para um detalhe pontual no capítulo 7 |

## Mapa de capítulos

| # | Capítulo | Período | O que aconteceu |
|---|---|---|---|
| 1 | [Gênese](01-genese.md) | 2026-04-01/02 | v0.1.0 — MVP funcional, os pivots que definiram a stack (OpenAI→Groq, Jina, config central) |
| 2 | [V1 — Hardening e Maturidade](02-v1-hardening.md) | 04-03 → 05-18 | 14 fases do V1 (project-aware → work modes), Brain/Wiki/Notion, QA em 3 fases, Goal Graph |
| 3 | [Consolidação VPS e Último Polimento](03-consolidacao-vps.md) | 05-18 → 05-28 | Notebook → VPS, Agents por papel, evidências de QA, hardening de segurança pré-V2 |
| 4 | [Nascimento da V2](04-nascimento-v2.md) | 05-29 → 05-31 | Scaffold do `apps/api-v2`, ~12 engines construídas em 3 dias |
| 5 | [Turbulência de Junho](05-turbulencia-junho.md) | 06-01 → 06-25 | Pivot NORTE (congela e descongela o executor), bugchain de 12 bugs, drift de role-policy (ADR-001/002/003) |
| 6 | [Guardian](06-guardian.md) | 06-26 → 06-30 | Sistema de vigilância proativa de código, construído em 1 dia e endurecido em "Blueprint v1.1" |
| 7 | [Estado Atual](07-estado-atual.md) | 07-01 → hoje | Hardening de segurança, incidentes de infra, V1 e V2 coexistindo |
| — | [Anexo — Log de commits](ANEXO-commits.md) | Todo o período | Evidência bruta: os 503 commits, agrupados pelos mesmos limites de data acima |

## Como usar isso depois

Cada capítulo é uma unidade independente que pode virar um estudo de caso: "como o Goal Graph foi construído", "como o pivot NORTE foi decidido e revertido", "como o Guardian detecta risco". A tag `fontes:` de cada um já aponta exatamente para onde ir buscar mais detalhe — commit, arquivo de memória ou blueprint — sem precisar regrepar o repositório inteiro.
