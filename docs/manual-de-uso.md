# Rayzen AI — Manual de Uso

> Manual operacional + arquitetura. Como o Rayzen funciona hoje e como usá-lo no dia a dia.
> Última revisão: 2026-06-11 (pivot — Rayzen = cérebro de memória/QA; executor de missões congelado).

---

## 1. O que é o Rayzen (em uma frase)

Uma plataforma pessoal de IA que **preserva contexto** (memória semântica, decisões, runbooks), **observa seu trabalho** (hook do Claude Code) e **alimenta o Claude Code** com contexto cirúrgico e relevante — para que problemas resolvidos uma vez não precisem ser resolvidos de novo.

**Papéis claros:**

| Quem | Papel |
|---|---|
| **Rayzen** | Cérebro persistente: memória semântica · contexto · governança QA · write-back de aprendizados |
| **Claude Code** | Executor: código, deploy, testes, análise |
| **Agent desktop** | Executor local: browser, terminal, screenshots, git |

**Rayzen não executa código.** O executor autônomo de missões LLM (V2) foi congelado — nunca funcionou de forma confiável. O que existe e funciona é o **loop de contexto + memória** que torna o Claude Code mais eficaz a cada sessão.

---

## 2. Arquitetura

### 2.1 Os três lugares onde o Rayzen vive

```
┌─ Sua máquina (Windows) ──────────────┐     ┌─ Notebook local (Ubuntu · Docker) ────┐
│ • VS Code + Claude Code               │     │ • PostgreSQL 16 + pgvector             │
│ • Hook (rayzen-hook.mjs)  ───eventos──┼────▶│ • Redis + LiteLLM                      │
│ • Agent desktop (agent-start.bat)     │◀────┼─ tarefas ─ • API V1 (:3101)            │
│ • MCP stdio (.mcp.json)               │     │ • API V2 (:3103) — context-engine       │
└───────────────────────────────────────┘     │ • Web (:3100) · Caddy (HTTPS)           │
                                               │ • MCP HTTP (:3102)                      │
                                               └────────────────────────────────────────┘
```

- **Hook** = sensor passivo. Cada ação no Claude Code (Edit/Write/Bash) vira um evento no Rayzen.
- **Agent** = braço executor. Recebe tarefas (`jarvis:*`) e executa no SO local (whitelist obrigatória).
- **MCP** = ponte para o Claude Code e claude.ai consultarem e gravarem no Rayzen.
- **Infra** = notebook local 192.168.0.175, Cloudflare Tunnel para domínio `rayzen.com.br`.

### 2.2 Estado dos módulos V2

| Estado | Módulos |
|---|---|
| **Vivo** (em uso) | `context-engine`, `specialist-agent`, `qa-engine`, `approval-gates`, `knowledge`, `memory`, `core/v1-bridge` |
| **Congelado** (dormente) | `mission`, `workflow`, `mission-scheduler`, `specialists` runtime, `router` |

O container `api-v2` continua rodando porque `rayzen_get_context` depende do `context-engine`. Ver `apps/api-v2/FROZEN.md` para detalhes.

---

## 3. Setup diário

1. **Notebook ligado.** A stack (Postgres, Redis, LiteLLM, APIs, Web, MCP) sobe sozinha com `restart: unless-stopped`.
2. **Agent desktop.** Na sua máquina, rode `agent-start.bat` — polling de tarefas `jarvis:*`.
3. **VS Code + Claude Code.** Abra a pasta do projeto. O hook detecta o projeto pelo `git remote` e começa a capturar eventos.
4. **Web.** Abra `http://192.168.0.175:3100` (ou `https://rayzen.com.br`), selecione o projeto no topo.

---

## 4. Como o hook vincula seu trabalho ao projeto certo

```
Você edita um arquivo no VS Code
   → hook lê o nome do repositório (git remote get-url origin)
   → consulta GET /projects?repoSlug=<nome>
   → vincula o evento ao projeto correspondente
```

**Resolução robusta:** `rayzen-ai-private`, `Rayzen-AI`, `Rayzen_AI` todos resolvem para o mesmo projeto — o backend normaliza (minúsculas, remove sufixo `-private`, troca `_`↔`-`).

**Stale-while-error:** se a rede pisca durante um deploy, o hook reusa o cache em vez de perder o evento.

**Diagnóstico:** `GET /events/hook/health` lista todos os projetos, último evento e eventos órfãos.
**Badge da Atividade:** 🟢 ao vivo (<10 min) · 🟡 há Xh · 🔴 parado.

---

## 5. Os painéis — o que cada um faz e QUANDO atualiza

| Painel | O que mostra | Quando atualiza | Como forçar |
|---|---|---|---|
| **Atividade** | Eventos do hook em tempo real | **Sozinho, a cada 5s** | — |
| **Goal Graph** | Meta do projeto, critérios, KPIs, progresso | **Só quando você edita** | Botão "EDITAR META" / "+ critério" |
| **Documentação viva** | 5 docs (estado, decisões, próximas ações, diário, evidências) | **No checkpoint** | Botão "Regenerar" / checkpoint |
| **Universe** | Canvas: docs, decisões e relações | **Manual** | Botão "atualizar" / "importar projeto" |
| **Brain / Memória** | Busca semântica na memória indexada | Ao indexar fontes | Painel Brain → indexar |

**Regra:** se um painel parece desatualizado, quase sempre é porque não atualiza sozinho — depende de checkpoint (Doc viva) ou edição manual (Goal Graph). Só a Atividade é ao vivo.

### Limitação conhecida — ruído na Doc viva

O ProjectState e a Doc viva derivam dos eventos do hook via LLM. Sessões com muitos comandos Bash/SSH de diagnóstico poluem o sinal — "Testar API local" vira "próxima ação". O **Goal Graph é a fonte estratégica confiável**; a Doc viva é apoio, não verdade absoluta.

---

## 6. Checkpoint — sincronização do ProjectState

O checkpoint mantém o Rayzen "em dia". Ao disparar (botão CHECKPOINT, ou automático a cada 2h / 15+ eventos), ele:

1. Sintetiza a sessão (resumo, decisões, próximos passos)
2. Refaz o ProjectState (via LLM) — objetivo, stage, blockers, milestones
3. Regenera os 5 docs da Documentação viva
4. Atualiza o Universe

Sem checkpoint, o ProjectState congela no último. **Se os painéis parecem velhos → falta checkpoint.**

---

## 7. Protocolo de sessão Claude Code ↔ Rayzen

### Contexto automático (não requer ação)
O hook `UserPromptSubmit` injeta o estado do projeto em cada prompt automaticamente (cache 5 min). Não é necessário chamar `rayzen_get_resume` em toda sessão.

### Quando usar MCP manualmente

| Situação | Tool |
|---|---|
| Início de task complexa (implementação / debugging) | `rayzen_get_context(mode, query)` |
| Decisão significativa tomada | `rayzen_add_event(intent:'decision', content:'...')` |
| Fim de sessão com código real modificado | `rayzen_checkpoint()` |
| Resolveu um problema não-trivial | `rayzen_capture_learning(...)` ← **o mais importante** |

### `rayzen_capture_learning` — o loop de write-back

Chame **depois de resolver um problema** para que o aprendizado persista e reapareça automaticamente nas próximas sessões.

```typescript
rayzen_capture_learning({
  title: "Deploy Rayzen AI no notebook local",   // curto e buscável
  problem: "O que quebrou / o sintoma observado",
  solution: "Como foi resolvido — passos concretos",
  type: "runbook",   // runbook | troubleshooting | decision | pattern | gotcha
  tags: ["deploy", "docker"],
  projectId: "<id>"  // opcional; escopo do projeto
})
```

**Quando chamar:**
- Consertou algo que quebrou (deploy, bug, config, auth)
- Tomou uma decisão de arquitetura relevante
- Descobriu um gotcha que vai repetir
- Criou um runbook (passo a passo que vai repetir)

**Quando NÃO chamar:**
- Desenvolvimento normal (feature, refactor)
- Conversa de análise sem conclusão concreta
- Perguntas simples

A pergunta-guia: *"Daqui a 2 meses, quero que o Rayzen já saiba isso?"* — Se sim, capture. Se não, pule.

O aprendizado é indexado via `MemoryService` com `projectId` e reaparece automaticamente em `rayzen_get_context` na próxima sessão de contexto relacionado.

---

## 8. MCP — conectar de dentro do Claude/claude.ai

O MCP HTTP (`https://rayzen.com.br/mcp`) expõe o Rayzen como conector OAuth. Autenticação com senha admin.

**Token persistente:** uma vez autorizado, sobrevive a restarts. Se pedir re-auth: Settings → Integrations → Rayzen → reconnect.

**Tools disponíveis:**

| Tool | O que faz |
|---|---|
| `rayzen_get_context` | Contexto cirúrgico por modo (implementation/debugging/review/architecture/study) + query semântica |
| `rayzen_get_resume` | Snapshot do ProjectState atual |
| `rayzen_get_goal` | Meta ativa + critérios + KPIs |
| `rayzen_add_event` | Registra decisão, ideia ou problema manualmente |
| `rayzen_checkpoint` | Dispara checkpoint (sintetiza sessão + regenera docs) |
| `rayzen_capture_learning` | Grava runbook/troubleshooting indexado na memória |
| `rayzen_search_memory` | Busca semântica na memória do projeto |
| `rayzen_get_wiki` | Consulta página da wiki por slug |
| `rayzen_update_planning` | Atualiza backlog e milestones |

---

## 9. Comandos úteis

```bash
# Desenvolvimento local
pnpm dev:api          # API V1 → :3101
pnpm dev:web          # Web → :3100
pnpm --filter api db:generate   # após mudança no schema Prisma

# Qualidade
pnpm --filter api test          # 198 testes unitários
pnpm --filter api test:e2e
pnpm typecheck
pnpm gen:catalog      # docs/agent-actions.md (ações + risco)
pnpm scan:secrets     # docs/security/data-inventory.md

# Deploy no notebook (via SSH)
ssh -i ~/.ssh/id_ed25519 rayzen@192.168.0.175
# Copiar arquivos modificados via SCP, depois:
cd ~/projects/rayzen-ai && ./infra/deploy.sh
# ou: docker compose up -d --build api mcp-http
```

**Pré-requisito deploy:** usuário `rayzen` no grupo `docker` (sem sudo).
```bash
sudo usermod -aG docker rayzen   # logout+login para ter efeito
```

---

## 10. Troubleshooting

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Hook não pega / badge 🔴 | API fora ou `repoSlug` errado | Verifique `GET /events/hook/health`; confira remote git do projeto |
| Doc viva / Próximas ações desatualizadas | Faltou checkpoint | Dispare checkpoint |
| Goal Graph com meta velha | Meta é manual | Edite a meta no painel |
| MCP pede re-auth | Token expirado | Reconnect no Claude → login com senha admin |
| Evento vinculado ao projeto errado | Cache de slug | Limpe `%TEMP%\rayzen-slug-cache.json` |
| `rayzen_capture_learning` não retorna em `rayzen_get_context` | `projectId` não foi passado | Passe o `projectId` correto na chamada |
| Deploy falha com "sudo required" | Usuário não está no grupo docker | `sudo usermod -aG docker rayzen` + logout+login |

---

## Referências no repo

- `CLAUDE.md` / `CLAUDE.local.md` — guia de desenvolvimento e protocolo de sessão
- `apps/api-v2/FROZEN.md` — módulos V2 congelados vs. vivos
- `infra/deploy.sh` — script de deploy para o notebook
- `blueprints/` — design da V2 (24 documentos, referência arquitetural)
- `docs/agent-actions.md` — catálogo de ações do agent (gerado por `pnpm gen:catalog`)
- `docs/security/data-inventory.md` — inventário de dados sensíveis (gerado)
- `memory/reference_vps_ssh.md` — acesso SSH ao notebook
