# H3 — `hermes serve` e `hermes desktop` medidos como HUB (17/09)

Item 3 da ordem combinada: **testar antes de escrever interface**. O que segue foi medido no
container `rayzen-hermes-spike` do H81, na versão `v0.21.2 (2026.9.11)`, upstream `bb0c2303`.

O container voltou ao estado em que estava: nenhum `serve` rodando. Nada foi persistido, nenhuma
configuração alterada.

---

## 1. `desktop` está fora, e o motivo é estrutural

`hermes desktop` é um app **Electron** — o help diz que instala dependências de workspace, builda o
app desempacotado do SO atual e lança o artefato. Precisa de sessão gráfica.

O H81 é Ubuntu headless. Então `desktop` não é candidato a HUB **no servidor**; se for usado, é na
máquina de trabalho, e aí ele é um cliente, não o HUB.

> Isso muda a pergunta. Um app de desktop na máquina de trabalho tem exatamente o problema que o
> HUB existe para resolver: o PC desligado. O autostart de 06/09 nasceu porque o agent ficou **28h
> fora sem nada acusar**.

---

## 2. CORREÇÃO (18/09): `serve` não é o HUB — `dashboard` é

Este documento concluiu que `hermes serve` era o candidato. **Estava errado**, e o erro estava
escrito no help que eu mesmo citei: *"Headless: it never opens a browser UI"*. Li como "não abre
uma janela de navegador"; significa **não serve UI**.

O que me enganou foi o login **funcionar**: a página de `/login` vem do middleware de
autenticação, não do app. Marcelo entrou com a senha certa e recebeu:

```json
{"error":"Headless backend (hermes serve): web UI disabled — use `hermes dashboard` for the browser UI."}
```

`serve` é o backend JSON-RPC/WebSocket para o **app desktop e clientes remotos**. `hermes
dashboard` é a interface de navegador — mesma porta, mesmo portão de autenticação, mais
`--no-open`.

> **Tudo o que este documento mediu sobre o PORTÃO continua valendo** — a recusa de bind sem
> provedor, o `_SESSION_TOKEN`, o 401 nas rotas protegidas, o alcance do MCP. O que estava errado
> era só qual processo serve a tela.
>
> **E a UI precisa ser construída.** Sem `dist`, o `dashboard` faz `npm install` + build a cada
> subida, e o destino (`hermes_cli/web_dist`) fica **fora** do volume `~/.hermes` — seria refeito a
> cada recriação de container. Medido antes de assar na imagem: build de **9,33s**, `dist` de
> **3,2 MB**, `node_modules` do web de 11 MB. O runtime passa `--skip-build`.

---

## 3. `serve` sobe, e sobe rápido

```
docker exec -d rayzen-hermes-spike sh -c 'cd /home/hermes && hermes serve --port 9119 --host 127.0.0.1'
```

Pronto em ~20s, sem precisar de `--skip-build`:

```
{"type": "setup.ready", "payload": {"provider_configured": true, "inference_provider": "lmstudio", ...}}
HERMES_BACKEND_READY port=9119
  Hermes backend listening on 127.0.0.1:9119
```

`/opt/hermes/agent/web/dist` **não existe** na imagem, mas `node_modules` e o Node de `/opt/node`
(v26.8.2) estão lá — o backend sobe sem a SPA construída.

---

## 4. A postura de autenticação é sólida, e eu li errado na primeira passada

`GET /api/health` devolve `{"ok":true,"version":"0.21.2","auth_required":false}`. Li isso como
"gateway sem autenticação" e **estava errado**: `auth_required` diz se o gate **OAuth** está ativo,
não se existe autenticação.

Medido, nos dois regimes:

| bind | o que acontece |
|---|---|
| `127.0.0.1` | todo `/api/` exige o `_SESSION_TOKEN`, injetado na SPA — só `/api/health` e `/api/status` são públicos |
| `0.0.0.0` sem provedor de auth | **recusa subir**, com mensagem explícita |

```
Refusing to bind dashboard to 0.0.0.0 — the auth gate engages on non-loopback binds (0.0.0.0),
but no auth providers are registered.
[...]
There is no unauthenticated public-dashboard option.
```

E fecha a brecha óbvia: *"a configured external public URL requires auth even when a local reverse
proxy reaches a loopback backend"*. Ou seja, pôr o Caddy na frente de um backend em loopback **não**
contorna o gate.

> Isso foi **medido, não lido no help**. O help afirmava; a house regra é conferir. Ele recusa o
> bind de verdade, com código de saída, não um aviso.
>
> **Consequência prática para o HUB:** expor exige decidir a autenticação primeiro — hash de senha
> em `config.yaml` (`dashboard.basic_auth`) ou um provedor OAuth. Não há caminho "só por enquanto".

O `_SESSION_TOKEN` é aleatório por subida, e `HERMES_DASHBOARD_SESSION_TOKEN` o fixa — foi assim
que os testes abaixo autenticaram.

---

## 5. O `serve` alcança o MCP do Rayzen, ponta a ponta

`GET /api/mcp/servers` lista o servidor como o `config.yaml` declara, com as 9 ferramentas de
leitura e nenhuma das 11 de escrita:

```json
{"name":"rayzen","transport":"http","url":"http://mcp-http:3102/mcp","auth":"header","enabled":true,
 "tools":{"include":["rayzen_get_context","rayzen_search_memory","rayzen_get_state", ...]}}
```

`POST /api/mcp/servers/rayzen/test` → `{"ok":true, "tools":[... 9 ...], "prompts":0, "resources":0}`.

E o que separa "a conexão funciona" de "o HUB responde com conhecimento do Rayzen" — o modelo
chamando a ferramenta:

```
hermes -z "Liste os projetos cadastrados no Rayzen usando rayzen_list_projects e diga QUANTOS são."
→ "Existem 10 projetos cadastrados: Alfa soluções, rayzen-job-hunter, Urna Trust Boundary,
   marcelorayzen-site, Rayzen Commerce Platform, VB Ferragens, Banco Imobiliário Online Caótico,
   Ray coach, Rayzen AI, Rayzen-PDV"
```

**10** é conferível contra o invariante `projeto_ativo_no_catalogo`, que no mesmo dia relatou
*"10 projeto(s) ativo(s), todos no catálogo"*. Resultado verificável, não impressão.

---

## 6. `gateway_running: false` — e "gateway" aqui não é o que o nome sugere

`GET /api/status`:

```json
{"gateway_running": false, "active_agents": 0, "active_sessions": 0,
 "components": {"gateway": {"status":"degraded","state":"stopped"},
                "dashboard": {"status":"ok","selftest":"ok"},
                "platforms": {"status":"ok","configured":0,"connected":0}},
 "overall": "degraded"}
```

`hermes gateway` é **mensageria** (WhatsApp, Slack, Telegram, peer-to-peer entre máquinas), não o
motor do agente — o motor rodou sem ele, como o § 4 mostra. `overall: degraded` com
`configured: 0` é o estado correto de quem não conectou plataforma nenhuma, não avaria.

> Vale como aviso: um painel que mostrasse `overall` cru diria "degradado" para sempre neste
> arranjo. Mesma família de `vermelho permanente é o que se aprende a ignorar`.

---

## 7. O achado lateral que toca uma pendência aberta

A reanálise de 17/09 registrou: *"resultado de trabalho agendado não volta ao canal"* — fechar isso
no Rayzen exigiria `AgentBridgeModule → TelegramModule`, que **fecha ciclo de módulo**, o mesmo que
derrubou a produção em 14/09.

O Hermes tem esse mecanismo pronto, e fora do processo da api:

```
GET /api/cron/delivery-targets
→ {"targets":[{"id":"local","name":"Local (save only)"},
              {"id":"bot-chat:default","name":"Bot Chat (default)"}]}
GET /api/cron/jobs      → []
GET /api/webhooks       → {"enabled":false,"base_url":"http://localhost:8644","subscriptions":[]}
```

Mais `/api/cron/jobs/{id}/trigger`, `/fire`, `/runs`, `/pause`, `/resume` e blueprints de job.

**O que está medido:** os alvos de entrega existem como conceito de primeira classe, e um job de
cron declara para onde o resultado vai.

**O que NÃO está medido, e não deve ser afirmado:** que a entrega no Telegram funciona. A lista só
traz `local` e `bot-chat:default` porque `platforms.configured` é **0** — nenhuma plataforma foi
conectada neste spike. Entrega real exige configurar o gateway de mensageria, e isso não foi feito.

> A tentação a resistir: o Rayzen **já tem** canal de Telegram funcionando (`telegram_responde`
> verde). Dois bots no mesmo Telegram é mais superfície e mais uma identidade, não menos.
> A pergunta certa antes de construir: o agendamento deve morar no Hermes (que já entrega) ou o
> Rayzen deve ganhar a entrega sem fechar o ciclo de módulos? Isso é decisão, não medição — fica
> em aberto de propósito.

---

## 8. Duas armadilhas que custaram tempo, registradas

**`hermes serve --status` mente quando o processo não foi ele quem lançou.** Com o backend
comprovadamente escutando em 9119, `serve --status` respondeu *"No hermes dashboard or serve
processes running."* Ele procura por pidfile/registro em `$HERMES_HOME`, e o processo lançado por
`docker exec` não aparece ali. Não use `--status` como prova de vida — use `/api/health`.

**Matar processo por varredura de cmdline mata o próprio shell.** O laço sobre `/proc/*/cmdline`
procurando `hermes*serve*` casou com a própria `sh -c` que o continha, e o comando saiu 143. É a
mesma lição do `ps | grep "[r]ayzen-deploy.sh"` de 13/09 — o truque do colchete não protege quando
**a sua própria linha de comando** contém a string. Aprendida duas vezes agora.

---

## 9. Balanço para o HUB

| pergunta | resposta medida |
|---|---|
| `desktop` serve como HUB? | **não** no servidor — Electron precisa de GUI |
| `serve` sobe headless? | **sim**, ~20s, sem build da SPA |
| dá para expor sem autenticação? | **não** — recusa o bind, e o proxy não contorna |
| alcança a memória do Rayzen? | **sim** — 9 ferramentas de leitura, e o modelo as usa |
| tem agendamento com entrega em canal? | **sim como mecanismo**; entrega real não testada |

**O que falta decidir antes de escrever interface** (não é medição):

1. autenticação do HUB — senha em `config.yaml` ou OAuth;
2. onde mora a sessão. A reanálise já apontou que *"o pivô para o HUB é o `sessionId`, não o
   modelo"*: a web recria `sessionId` a cada carregamento, o Telegram persiste por
   `(chatId, threadId)`, e os dois nunca se encontram. O `serve` traz um terceiro registro de
   sessões (`state.db`), e três lugares guardando linha de conversa é pior que dois;
3. se o escopo geral decidido em 17/09 ("infere e declara") é resolvido pelo lado do Rayzen
   (contexto) ou pelo lado do Hermes (sessão).
