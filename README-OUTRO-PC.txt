RAYZEN AI - SETUP DO OUTRO PC

Objetivo
- Este PC de trabalho roda apenas o Agent.
- O notebook hospeda API + banco + Redis + ngrok.
- O Web principal esta publicado em: https://rayzen-web.vercel.app

Importante
- Nao assuma que o estado deste projeto esta no Git.
- O estado correto pode estar vindo por pendrive/copia local.
- Se existir diferenca entre o repo clonado e os arquivos trazidos do notebook, preserve os arquivos locais trazidos do notebook.
- Nao reverta scripts locais sem revisar o fluxo abaixo.

Arquivos esperados na raiz do projeto
- agent-start.bat
- .env.agent.ready
- package.json
- apps\agent\...

Como preparar
1. Se o projeto veio por clone e tambem por pendrive, use a copia mais recente do pendrive para sobrescrever os arquivos locais.
2. Renomeie `.env.agent.ready` para `.env`.
3. Confirme que o `.env` contem:
   - AGENT_API_URL=https://...ngrok-free.dev
   - AGENT_TOKEN=...
   - AGENT_POLL_INTERVAL_MS=3000
4. Confirme que Node 20 e pnpm estao instalados.

Como iniciar
1. Abra PowerShell na raiz do projeto.
2. Rode:
   agent-start.bat
3. O script deve:
   - validar conectividade com a API remota em `/tasks/pending`
   - compilar o agent
   - abrir uma janela do Agent em execucao continua

Pre-condicoes obrigatorias
- O notebook precisa estar ligado.
- No notebook, o script `notebook-api-tunnel.bat` precisa estar rodando.
- O ngrok da API precisa estar ativo.
- Se a URL do ngrok mudou, atualize `AGENT_API_URL` no `.env` antes de subir o agent.

Validacao rapida
- Ao iniciar, o Agent deve mostrar algo como:
  - `Rayzen PC Agent iniciado`
  - `Polling a cada 3000ms -> https://...`
- Se falhar na validacao inicial, revisar:
  - internet nesta maquina
  - URL do ngrok
  - AGENT_TOKEN
  - notebook/API online

Nao fazer
- Nao subir Web local nesta maquina.
- Nao subir Postgres/Redis nesta maquina.
- Nao usar `pnpm dev` para o agent se `agent-start.bat` funcionar; o script atual usa build + start por estabilidade.

Se precisar ajustar manualmente
- Instalar dependencias:
  pnpm install --frozen-lockfile
- Compilar agent:
  pnpm --filter agent build
- Iniciar agent:
  pnpm --filter agent start

Resumo de arquitetura
- Notebook: API em localhost:3101 + ngrok publico
- Vercel: Web em https://rayzen-web.vercel.app
- Outro PC: Agent local apontando para AGENT_API_URL
