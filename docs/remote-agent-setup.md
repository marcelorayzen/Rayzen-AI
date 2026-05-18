# Rayzen em 2 camadas (VPS + PC de trabalho)

## 1) VPS (servidor Rayzen)

1. Mantenha a stack central na VPS:
   - `Postgres`
   - `Redis`
   - `LiteLLM`
   - `API`
   - `Web`
2. Endpoints atuais:
   - Web: `http://<VPS_PUBLIC_IP>:3100`
   - API: `http://<VPS_PUBLIC_IP>:3101`
3. O banco oficial fica na VPS. O PC de trabalho não precisa manter Postgres local para operar o Rayzen.

## 2) PC de trabalho (Agent desktop)

1. Clone o repo.
2. Configure o `.env` usado por `agent-start.bat`:
   - `AGENT_ROLE=desktop`
   - `AGENT_API_URL=http://<VPS_PUBLIC_IP>:3101`
   - `AGENT_TOKEN=<mesmo token configurado na VPS>`
3. Inicie:
   - `agent-start.bat`
4. O script:
   - valida conectividade em `/tasks/pending`
   - compila o `agent`
   - inicia `node dist/index.js`
5. O Agent aceita Node.js `20+` no PC de trabalho. Isso é independente da versão exigida pelo projeto que estiver aberto no VS Code.

## 3) Hook global e separação por projeto

1. O hook global do Claude fica em `%USERPROFILE%\\.claude\\settings.json`.
2. O script executado pelo hook fica em:
   - `apps/agent/src/hooks/rayzen-hook.mjs`
3. No `hook.config.mjs`, use:

```js
export default {
  apiUrl: 'http://<VPS_PUBLIC_IP>:3101',
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
        "AGENT_API_URL": "http://<VPS_PUBLIC_IP>:3101",
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

## 6) Agent da VPS

O Agent da VPS executa apenas ações próprias do servidor, como:

- `docker_ps`
- `docker_logs`
- `docker_start`
- `docker_stop`
- `restart_api`

Configuração preferida na VPS: serviço `agent-server` do `docker-compose.yml`.

```bash
docker compose build agent-server
docker compose up -d agent-server
```

Configuração alternativa fora do compose:

```bash
cp .env.agent.server.example .env.agent.server
# editar AGENT_TOKEN se necessário
chmod +x agent-server-start.sh
./agent-server-start.sh
```

Separação operacional:

| Papel | Onde roda | Exemplos |
|---|---|---|
| `desktop` | PC de trabalho | screenshot, VS Code, clipboard, testes locais, provas visuais |
| `server` | VPS | logs de containers, Docker da stack, restart da API |

`screenshot` fica no desktop; provas visuais saem da tela real do usuário. Na VPS, a evidência normalmente é log, status de container ou resposta HTTP.

## 7) Evidências visuais por projeto

1. Com um projeto ativo no Rayzen, peça:
   - `tire um print da tela: teste de API 52`
2. O fluxo esperado é:
   - o desktop Agent captura a tela real do PC;
   - salva localmente em `Pictures\Rayzen\<repoSlug>\...`;
   - faz upload para a API da VPS;
   - cria uma evidência vinculada ao projeto;
   - mostra o item na aba **Evidências**;
   - alimenta o documento **Evidências de teste**.
3. O trecho após `:` vira:
   - descrição da evidência;
   - base do nome do arquivo;
   - insumo para a categoria automática.
4. Categorias iniciais:
   - `api_test`
   - `manual_test`
   - `bug`
   - `fix`
   - `general`

### Evolução planejada

- Etapa futura 1: vincular evidência ao `TestRun` do projeto.
- Etapa futura 2: vincular evidência a uma falha/caso específico do run.
