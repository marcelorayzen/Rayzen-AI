# Rayzen em 2 maquinas (Notebook + PC de trabalho)

## 1) Notebook (servidor Rayzen)
1. Configure o `.env` com:
   - `AGENT_TOKEN` forte.
   - `ADMIN_PASSWORD` forte.
   - `JWT_SECRET` forte.
2. Suba o servidor:
   - `notebook-api-tunnel.bat`
3. O script abre:
   - `Postgres`
   - `Redis`
   - `API` local em `http://localhost:3101`
   - `ngrok http 3101`
4. Copie a URL HTTPS do `ngrok`.
5. No Web publicado em `https://rayzen-web.vercel.app`, preencha:
   - campo `URL da API` com a URL do `ngrok`
   - senha com `ADMIN_PASSWORD`

## 2) PC de trabalho (agent remoto)
1. Clone o repo.
2. Copie `.env.agent.example` para `.env`.
3. Preencha:
   - `AGENT_API_URL=https://SEU-ENDPOINT-API`
   - `AGENT_TOKEN=<mesmo token do notebook>`
4. Inicie:
   - `agent-start.bat`
5. O script:
   - valida conectividade em `/tasks/pending`
   - compila o `agent`
   - inicia `node dist/index.js`

## 3) Seguranca minima obrigatoria
- Nunca exponha API sem HTTPS.
- Nao reutilize token fraco em `AGENT_TOKEN`.
- Rotacione `AGENT_TOKEN` se houver suspeita de vazamento.

## 4) Comportamento atual da API
- Endpoints de fila do agent (`/tasks/*`) exigem `Authorization: Bearer <AGENT_TOKEN>`.
- Sem token correto, o Agent nao consegue consumir tarefas.

## 5) Operacao diaria
- Notebook ligado com `notebook-api-tunnel.bat`.
- PC de trabalho ligado com `agent-start.bat`.
- Web acessado por `https://rayzen-web.vercel.app`.
- Quando a URL do `ngrok` mudar, atualize:
  - o campo `URL da API` no Web
  - `AGENT_API_URL` no `.env` do PC de trabalho
