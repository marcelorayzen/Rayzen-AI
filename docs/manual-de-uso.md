# Rayzen AI — Manual de Uso

> Manual operacional + arquitetura. Como o Rayzen funciona hoje e como usá-lo no dia a dia.
> Última revisão: 2026-05-31 (pós-V2 + estabilização de hook/MCP).

---

## 1. O que é o Rayzen (em uma frase)

Uma plataforma pessoal de IA que **observa seu trabalho** (via hook do Claude Code), **preserva contexto** (memória, conhecimento, documentação viva) e **executa fluxos** (agente local + missões), coordenando tudo entre a sua máquina e uma VPS central.

Hoje o Rayzen tem **duas gerações rodando lado a lado**:

| | V1 (estável, em uso diário) | V2 (construída, em adoção) |
|---|---|---|
| O que é | Assistente conversacional + automação | Sistema orientado a **missões** |
| Onde | `apps/api` · porta 3101 | `apps/api-v2` · porta 3103 · prefixo `/v2` |
| Estado | É o que você usa todo dia | 19 módulos prontos, ainda não plugados na interface |
| Banco | schema `public` | schema `v2` (mesmo Postgres) |

A V2 **não substituiu** a V1 — ela coexiste. A V1 continua sendo a interface do dia a dia; a V2 é o motor que será adotado gradualmente.

---

## 2. Arquitetura em camadas

### 2.1 Os três lugares onde o Rayzen vive

```
┌─ Sua máquina (Windows) ──────────────┐     ┌─ VPS Azure (Docker) ───────────────┐
│ • VS Code + Claude Code               │     │ • PostgreSQL 16 + pgvector          │
│ • Hook (rayzen-hook.mjs)  ───eventos──┼────▶│ • Redis + LiteLLM                   │
│ • Agent desktop (agent-start.bat)     │◀────┼─ tarefas ─ • API V1 (:3101)         │
│ • MCP local (.mcp.json)               │     │ • API V2 (:3103)                    │
└───────────────────────────────────────┘     │ • Web (:3100) · Caddy (HTTPS)       │
                                               │ • Agent server · MCP HTTP (:3102)   │
                                               └─────────────────────────────────────┘
```

- **Hook** = sensor passivo. Cada ação no Claude Code (Edit/Write/Bash) vira um evento no Rayzen.
- **Agent** = braço executor. Recebe tarefas (`jarvis:*`) e executa no SO local (whitelist obrigatória).
- **MCP** = ponte para o Claude/ChatGPT consultarem o Rayzen de fora.

### 2.2 Os engines da V2 (a arquitetura nova)

A V2 organiza o sistema em engines, cada um um módulo NestJS isolado em `apps/api-v2`:

| Camada | Engine | O que faz |
|---|---|---|
| Entrada | **Router** | Classifica a intenção → vira missão, skill ou chat |
| Núcleo | **Mission Engine** | Unidade de execução: missão com steps e lifecycle |
| Execução | **Workflow Engine** | DAG de steps (paralelo + retry) dentro de uma missão |
| Execução | **Skill Engine** | Catálogo de 34 ações; despacha pro agente |
| Execução | **Specialists** | Agentes de IA temporários (coder, reviewer, tester...) criados sob demanda |
| Inteligência | **AI Router** | Escolhe o modelo por custo/complexidade (tiers) |
| Inteligência | **Context Engine** | Monta o contexto mínimo para cada tarefa |
| Conhecimento | **Memory Engine** | Fatos: o que aconteceu (lifecycle inbox→working→consolidated) |
| Conhecimento | **Knowledge Engine** | Relações: como as coisas se conectam (grafo) |
| Conhecimento | **Project Memory** | Decisões, lições, padrões por projeto |
| Qualidade | **QA Engine** | Gate de qualidade (testes + data quality) |
| Qualidade | **Documentation Engine** | Gera docs por missão concluída |
| Governança | **Vault Engine** | Segredos criptografados (AES-256), nunca em contexto LLM |
| Governança | **Approval Gates** | Pausa missões de risco alto para aprovação |
| Governança | **Cost Controller** | Orçamento de tokens, bloqueio ativo |
| Governança | **Observability** | Trace distribuído por missão |
| Governança | **Resource Manager** | Limites de tokens/agentes/loops |
| Orquestração | **Mission Scheduler** | Fila de missões com prioridade e dependências |

**Memory vs Knowledge** (a distinção-chave): Memory guarda *fatos* ("a tarefa X foi concluída"); Knowledge guarda *relações* ("módulo Pedidos depende de Estoque"). São complementares.

---

## 3. Setup diário — passo a passo

1. **VPS ligada.** A stack central (Postgres, Redis, LiteLLM, API, Web, MCP) sobe sozinha com `restart: unless-stopped`. Se a VM estava desligada, ligue (ver `memory/reference_vps_ssh.md`).
2. **Agent desktop.** Na sua máquina, rode `agent-start.bat` — ele faz polling e executa as ações `jarvis:*`.
3. **VS Code + Claude Code.** Abra a pasta do projeto. O hook detecta o projeto sozinho (ver §4) e começa a capturar eventos.
4. **Web.** Abra `http://<VPS_IP>:3100` (ou o domínio), selecione o projeto no topo esquerdo.

---

## 4. Como o hook vincula seu trabalho ao projeto certo

Este é o ponto que mais deu dor de cabeça — está resolvido, mas vale entender:

```
Você edita um arquivo no VS Code
   → hook lê o nome do repositório (git remote get-url origin)
   → consulta GET /projects?repoSlug=<nome>
   → vincula o evento ao projeto correspondente
```

**Resolução robusta (não quebra mais por nome):** `rayzen-ai-private`, `Rayzen-AI`, `Rayzen_AI` todos resolvem para o mesmo projeto — o backend normaliza (minúsculas, remove sufixo `-private`, troca `_`↔`-`).

**Stale-while-error:** se a rede pisca (ex.: durante um deploy), o hook reusa o cache em vez de "perder" o evento. Antes, um hiccup de 1s desvinculava — agora não.

**Como saber se está funcionando:** o painel **Atividade** tem um indicador no topo:
- 🟢 **ao vivo** = recebeu evento há menos de 10 min
- 🟡 **há Xh** = parado há algumas horas
- 🔴 **há Nd / sem eventos** = algo quebrou

**Diagnóstico fundo:** `GET /events/hook/health` lista todos os projetos, último evento de cada, e contagem de eventos órfãos.

---

## 5. Os painéis — o que cada um faz e QUANDO atualiza

Esta é a tabela mais importante do manual. A confusão geralmente é não saber *quando* cada painel atualiza.

| Painel | O que mostra | Quando atualiza | Como forçar |
|---|---|---|---|
| **Atividade** | Eventos do hook em tempo real | **Sozinho, a cada 5s** | — (é ao vivo) |
| **Goal Graph** | Meta do projeto, critérios, KPIs, progresso | **Só quando VOCÊ edita** a meta | Botão "EDITAR META" / "+ critério" / "auto-detectar" KPI |
| **Documentação viva** | 5 docs (estado, decisões, próximas ações, diário, evidências) | **No checkpoint** | Botão "Regenerar" / disparar checkpoint |
| **Universe** | Canvas livre: docs, decisões e relações conectados | **Manual** | Botão "atualizar" / "importar projeto" |
| **Brain** | Busca semântica na memória indexada | Ao indexar fontes | Painel Brain → indexar |

**Regra de ouro:** se um painel parece "desatualizado", quase sempre é porque ele **não atualiza sozinho** — depende de um checkpoint (Doc viva) ou de você editar (Goal Graph). Só a Atividade é ao vivo.

### ⚠️ Limitação conhecida — ruído operacional na Doc viva

O ProjectState e a Documentação viva (especialmente "Próximas Ações") derivam dos **eventos do hook** via LLM. Quando uma sessão tem **muito ruído operacional** — centenas de comandos `Bash`/`SSH` de diagnóstico e desenvolvimento — esse ruído afoga o sinal estratégico, e o LLM chega a transformar a descrição de um comando ("Testar API local vs domínio") em "próxima ação".

**Consequência prática:** depois de sessões intensas de dev/diagnóstico, a Doc viva fica poluída. Não é bug do checkpoint — é o pipeline pesando todos os eventos igualmente.

**O que confiar então:**
- **Goal Graph** é a fonte estratégica confiável — você define a meta manualmente, ela não sofre com ruído.
- **Documentação viva** é melhor após sessões de trabalho *focado* (poucos comandos, mudanças de código reais) do que após sessões de diagnóstico.

**Correção de design pendente** (não implementada): ancorar a geração de "Próximas Ações" na **meta ativa do Goal Graph** em vez dos eventos brutos, e filtrar comandos de diagnóstico do sinal. Até lá, trate a Doc viva como apoio, não como verdade absoluta.

---

## 6. Checkpoint — o coração da sincronização

O **checkpoint** é o que mantém o Rayzen "em dia". Quando você dispara (botão CHECKPOINT, ou automático a cada 2h / 15+ eventos), em background ele:

1. **Sintetiza a sessão** — resumo do que foi feito, decisões, próximos passos
2. **Refaz o ProjectState** (via Claude Sonnet) — objetivo, stage, blockers, milestones
3. **Regenera os 5 docs** da Documentação viva
4. **Atualiza o Universe**

Sem checkpoint, o ProjectState e a Documentação viva ficam congelados no último checkpoint. **Se passou uma sessão de trabalho real e os painéis parecem velhos → falta checkpoint.**

> Pelo MCP (de dentro do Claude), o protocolo de sessão pede: `rayzen_get_resume()` ao começar, `rayzen_add_event(decision)` nas decisões, `rayzen_checkpoint()` ao terminar uma sessão com código.

---

## 7. MCP — usar o Rayzen de dentro do Claude/ChatGPT

O MCP HTTP (`https://rayzen.com.br/mcp`) expõe o Rayzen como conector. Autenticação OAuth (login com a senha admin).

- **Token persistente:** uma vez autorizado, o token fica salvo em disco (`storage/mcp/tokens.json`) e **sobrevive a restarts** — não pede re-auth todo dia.
- **Robusto:** JSON malformado não derruba mais o servidor (responde 400).
- **Tools:** `rayzen_get_resume`, `rayzen_get_goal`, `rayzen_add_event`, `rayzen_checkpoint`, `rayzen_search_memory`, etc.

Se o conector pedir reautorização: Settings → Integrations → Rayzen → reconnect → login com senha admin. Depois o token persiste.

---

## 8. A V2 — como começar a usar

A V2 está deployada mas ainda não tem interface. Para experimentar via API (porta 3103, prefixo `/v2`, mesmo JWT da V1):

```bash
# Criar uma missão a partir de um objetivo em linguagem natural:
POST /v2/route { "content": "Implemente login por email", "projectId": "<id>" }
  → classifica, planeja steps e cria a missão

# Executar a missão (Workflow DAG + Specialists):
POST /v2/workflows/missions/:id/execute { "projectId": "<id>" }

# Outros:
GET  /v2/skills                  # catálogo de 34 ações com risco
GET  /v2/ai/models               # tiers de modelo
POST /v2/knowledge/build/:pid    # popular o grafo de conhecimento do projeto
GET  /v2/costs/:pid              # custo por projeto
```

Swagger da V2: `https://api.rayzen.com.br/v2/docs`.

O **próximo foco do projeto** (meta ativa no Goal Graph) é justamente conectar a interface web a essas rotas e rodar a primeira missão real end-to-end.

---

## 9. Comandos úteis

```bash
# Qualidade / auditoria (geram docs a partir do código — nunca desatualizam)
pnpm gen:catalog        # docs/agent-actions.md — catálogo de ações + matriz de risco
pnpm scan:secrets       # docs/security/data-inventory.md — varre segredos versionados

# Testes
pnpm --filter api test  # 198 testes unitários
pnpm --filter api test:e2e

# Deploy (na VPS, via SSH)
git pull && docker compose up -d --build <serviço>
```

---

## 10. Troubleshooting

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| "Rayzen desconectou, hook não pega" | Quase sempre **percepção** — o painel não atualiza sozinho, ou foi hiccup | Olhe o badge da Atividade; rode `GET /events/hook/health` |
| Atividade mostra badge 🔴 | Hook realmente parou | Veja se a VPS/API está no ar; confira `repoSlug` do projeto vs remote git |
| Doc viva / Próximas ações desatualizadas | Faltou checkpoint | Dispare um checkpoint |
| Goal Graph com meta velha | Meta é manual, não atualiza sozinha | Edite a meta / crie uma nova |
| MCP pede re-auth | Token expirou (30d) ou nunca autorizou | Reconnect no Claude → login |
| Evento vinculado ao projeto errado | Cache de slug ou MCP_PROJECT_ID | Limpe `%TEMP%\rayzen-slug-cache.json` |

---

## Referências no repo

- `CLAUDE.md` / `CLAUDE.local.md` — guia de desenvolvimento e protocolo de sessão
- `blueprints/` — design completo da V2 (24 documentos)
- `docs/agent-actions.md` — catálogo de ações (gerado)
- `docs/security/data-inventory.md` — inventário de dados sensíveis (gerado)
