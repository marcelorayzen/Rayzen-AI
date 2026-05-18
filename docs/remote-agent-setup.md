# Rayzen em 2 camadas (VPS + PC de trabalho)

## 1) VPS (servidor Rayzen)

1. Mantenha a stack central na VPS:
   - `Postgres`
   - `Redis`
   - `LiteLLM`
   - `API`
   - `Web`
2. Endpoints atuais:
   - Web: `http://<VPS_IP>:3100`
   - API: `http://<VPS_IP>:3101`
3. O banco oficial fica na VPS. O PC de trabalho não precisa manter Postgres local para operar o Rayzen.

## 2) PC de trabalho (Agent remoto)

1. Clone o repo.
2. Configure o `.env` usado por `agent-start.bat`:
   - `AGENT_API_URL=http://<VPS_IP>:3101`
   - `AGENT_TOKEN=<mesmo token configurado na VPS>`
3. Inicie:
   - `agent-start.bat`
4. O script:
   - valida conectividade em `/tasks/pending`
   - compila o `agent`
   - inicia `node dist/index.js`

## 3) Hook global e separação por projeto

1. O hook global do Claude fica em `%USERPROFILE%\\.claude\\settings.json`.
2. O script executado pelo hook fica em:
   - `apps/agent/src/hooks/rayzen-hook.mjs`
3. No `hook.config.mjs`, use:

```js
export default {
  apiUrl: 'http://<VPS_IP>:3101',
  apiToken: '<jwt-token>',
  projectId: '',
}
```

4. Com `projectId` vazio, o hook resolve o projeto pelo `repoSlug` do repositório Git aberto:
   - `rayzen-ai` -> `Rayzen AI`
   - `Rayzen-PDV` -> `Rayzen-PDV`
5. Para não misturar projetos:
   - cada projeto no Rayzen precisa ter `repoSlug` correto;
   - o workspace aberto precisa ser um repositório Git com `origin` coerente.

## 4) MCP por projeto

O hook é global, mas o MCP continua sendo configurado por projeto porque precisa de um `PROJECT_ID` explícito para consultar memória, estado e eventos do projeto correto.

Exemplo:

```json
{
  "mcpServers": {
    "rayzen": {
      "command": "node",
      "args": ["<CAMINHO_RAYZEN_AI>/apps/agent/dist/mcp-server.js"],
      "env": {
        "AGENT_API_URL": "http://<VPS_IP>:3101",
        "AGENT_TOKEN": "<agent-token>",
        "PROJECT_ID": "<id-do-projeto>"
      }
    }
  }
}
```

## 5) Segurança mínima obrigatória

- Nunca exponha API sem HTTPS por longo prazo.
- Não reutilize token fraco em `AGENT_TOKEN`.
- Rotacione `AGENT_TOKEN` se houver suspeita de vazamento.
- Próximo passo recomendado: domínio + HTTPS com proxy reverso.
