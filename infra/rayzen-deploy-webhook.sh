#!/usr/bin/env bash
# Cópia de referência do script que roda de verdade em ~/bin/rayzen-deploy.sh no servidor H81
# (servidor-local) — disparado pelo forced-command da chave `rayzen-webhook-deploy` em
# ~/.ssh/authorized_keys a cada push em `main` (via triggerRemoteBuild() em
# apps/agent/src/mcp/rayzen-mcp-http.mjs).
#
# Fica FORA do checkout do git de propósito (~/bin/, não ~/projects/rayzen-ai/infra/): o script
# faz `git pull` no meio da própria execução, e um script que vive DENTRO do diretório que ele
# mesmo atualiza corre o risco de ser reescrito pelo `git pull` enquanto o bash ainda está lendo
# o arquivo. Esta cópia é só documentação/histórico — para mudar o comportamento real, edite e
# copie de novo para ~/bin/rayzen-deploy.sh no servidor (scp + chmod +x), não edite lá direto sem
# atualizar aqui também.
#
# Achado em 2026-09-13 (ver docs/plano-execucao-tipada.md e memória `project-webhook-build-
# overlap-empilhamento`): o forced-command antigo não tinha nenhuma trava contra sobreposição —
# `setsid nohup bash -c 'git pull && docker compose up -d --build ... && docker builder prune
# ...' &` a cada push, sem checar se o anterior já tinha terminado. Resultado: 17 processos de
# build ficaram vivos simultaneamente desde 11/09, nenhum jamais completou, competindo entre si
# para sempre — produção ficou ~36h atrás do `main` com `docker compose ps` mostrando tudo
# `Up (healthy)` o tempo todo.
#
# flock (não-bloqueante) + loop de drenagem resolve os dois lados do problema:
#   - nunca duas builds ao mesmo tempo (quem chega com o lock ocupado só registra e sai)
#   - nenhum push se perde (a build em andamento re-checa origin/main ao terminar e builda de
#     novo se algo novo chegou durante a build, antes de soltar o lock)
set -uo pipefail
cd ~/projects/rayzen-ai || exit 1

# ── Avisar o dono por FORA da plataforma ────────────────────────────────────────
#
# Fala direto com a API do Telegram, nunca com a api do Rayzen. Em 14/09 o que quebrou foi
# justamente a api: mandar o aviso por ela seria pedir que o serviço caído anunciasse a própria
# queda. O canal que conta o incidente não pode ser o que está no incidente.
avisar() {
  local TOKEN CHAT
  TOKEN=$(grep -m1 '^TELEGRAM_BOT_TOKEN=' .env 2>/dev/null | cut -d= -f2-)
  CHAT=$(grep -m1 '^TELEGRAM_CHAT_ID=' .env 2>/dev/null | cut -d= -f2-)
  [ -n "$TOKEN" ] && [ -n "$CHAT" ] || return 0
  curl -s -m 15 -o /dev/null -X POST "https://api.telegram.org/bot$TOKEN/sendMessage" \
    --data-urlencode "chat_id=$CHAT" --data-urlencode "text=[deploy] $1"
}

# ── O deploy termina quando o serviço FICOU de pé, não quando o `up -d` retornou ──
#
# Em 14/09 um ciclo de módulos NestJS derrubou a api: `docker compose up -d` devolveu sucesso, o
# script registrou deploy concluído e foi embora — com o container em `Restarting`, reiniciando
# em loop por `restart: unless-stopped`. Ninguém soube pelo deploy; soube-se pela aplicação fora
# do ar. Código de saída não é evidência de trabalho feito, a mesma regra do CLAUDE.md.
#
# Exige **duas leituras boas consecutivas**: um container que reinicia em loop passa por `running`
# entre as quedas, e uma única amostra sorteada nesse instante diria que está tudo bem.
#
# `agent-server` não declara healthcheck, então `Health` vem vazio — vazio é aceito, `unhealthy`
# não. Tratar ausência de healthcheck como falha deixaria o deploy vermelho para sempre.
verificar_subiu() {
  local LIMITE=$(( $(date +%s) + 180 ))
  local BOAS=0 RUIM LINHA ESTADO SAUDE SVC

  while :; do
    RUIM=""
    for SVC in $ALVOS; do
      LINHA=$(docker compose ps --format '{{.State}}|{{.Health}}' "$SVC" 2>/dev/null | head -1)
      ESTADO=${LINHA%%|*}
      SAUDE=${LINHA#*|}
      if [ "$ESTADO" != "running" ]; then
        RUIM="$RUIM $SVC=${ESTADO:-ausente}"
      elif [ -n "$SAUDE" ] && [ "$SAUDE" != "healthy" ]; then
        RUIM="$RUIM $SVC=$SAUDE"
      fi
    done

    if [ -z "$RUIM" ]; then
      BOAS=$(( BOAS + 1 ))
      [ "$BOAS" -ge 2 ] && return 0
    else
      BOAS=0
    fi

    [ "$(date +%s)" -ge "$LIMITE" ] && break
    sleep 15
  done

  echo "$RUIM"
  return 1
}

exec 9>/tmp/rayzen-deploy.lock
if ! flock -n 9; then
  echo "$(date -Is) [deploy] build ja em andamento -- este push sera pego pelo loop atual" >> ~/logs/deploy.log
  exit 0
fi

while true; do
  git fetch --quiet origin main || { echo "$(date -Is) [deploy] git fetch falhou" >> ~/logs/deploy.log; break; }
  CURRENT=$(git rev-parse HEAD)
  LATEST=$(git rev-parse origin/main)
  if [ "$CURRENT" = "$LATEST" ]; then
    echo "$(date -Is) [deploy] HEAD ja em $CURRENT -- nada a fazer" >> ~/logs/deploy.log
    break
  fi
  echo "$(date -Is) [deploy] $CURRENT -> $LATEST" >> ~/logs/deploy.log
  git pull --quiet || { echo "$(date -Is) [deploy] git pull falhou" >> ~/logs/deploy.log; break; }
  # ── Build EM SÉRIE, um serviço por vez ──────────────────────────────────────
  #
  # Era `docker compose up -d --build web api api-v2 agent-server`, que builda os quatro em
  # PARALELO. Cada um roda `pnpm install --frozen-lockfile` do monorepo inteiro, e nesta
  # máquina (4 núcleos, 11 GiB) os quatro se estrangulam: medido em 14/09, quatro processos
  # `pnpm install` simultâneos acumularam **35 segundos de CPU em 30 minutos de vida**, com o
  # log do BuildKit parado e 217 MB de memória livre.
  #
  # Não era rede: DNS e `registry.npmjs.org` respondiam em 0,12s, inclusive de dentro de um
  # container. Buildando a api SOZINHA, o mesmo passo terminou com `EXIT=0` normalmente.
  #
  # Este é o "build frio que não termina" que vinha sendo tratado como timeout do webhook desde
  # 11/09 — o `execFile` de 600s em `triggerRemoteBuild()` matava o cliente SSH, o daemon seguia,
  # e a assinatura final era "imagem nova, container velho". A causa estava um degrau abaixo.
  #
  # Em série o deploy é mais lento no papel e mais rápido na prática, porque termina.
  # ── `mcp-http` entra só quando o código dele mudou ──────────────────────────
  #
  # Ele nunca esteve na lista, e isso custou um achado em 13/09: a imagem estava parada em
  # 06/09, uma semana antes de a Fase 8 existir, e `MCP_TOKEN_RAYZEN_AI` devolvia `unauthorized`
  # com o token corretamente configurado. Qualquer mudança em `apps/agent/src/mcp/*` ficava
  # invisível em produção até alguém lembrar de rodar o build à mão.
  #
  # Pôr na lista fixa seria trocar um defeito por outro: `mcp-http` é o servidor MCP que os
  # conectores mantêm aberto (e é quem RECEBE o webhook do GitHub). Recriá-lo a cada push
  # derrubaria sessão de MCP em todo deploy, inclusive nos que não tocam nele.
  #
  # O gatilho é o diff: ele compartilha `apps/agent/Dockerfile.server` com o `agent-server`, então
  # o que muda o conteúdo da imagem dele é `apps/agent/**` — mais o compose, que carrega as
  # variáveis de ambiente que o serviço declara uma a uma.
  ALVOS="web api api-v2 agent-server"
  if git diff --name-only "$CURRENT" "$LATEST" | grep -qE '^(apps/agent/|docker-compose\.yml$)'; then
    ALVOS="$ALVOS mcp-http"
    echo "$(date -Is) [deploy] mcp-http incluido -- apps/agent ou compose mudou" >> ~/logs/deploy.log
  fi

  BUILD_OK=1
  for SVC in $ALVOS; do
    echo "$(date -Is) [deploy] build $SVC" >> ~/logs/deploy.log
    if ! docker compose build "$SVC"; then
      echo "$(date -Is) [deploy] build de $SVC falhou -- abortando loop" >> ~/logs/deploy.log
      avisar "build de $SVC falhou em $LATEST -- producao segue no codigo anterior"
      BUILD_OK=0
      break
    fi
  done
  [ "$BUILD_OK" = "1" ] || break

  # `--no-build`: as imagens já foram construídas acima. Sem isto o compose poderia rebuildar
  # em paralelo e reintroduzir exatamente a contenção que a série evita.
  if ! docker compose up -d --no-build $ALVOS; then
    echo "$(date -Is) [deploy] docker compose up falhou -- abortando loop" >> ~/logs/deploy.log
    avisar "docker compose up falhou em $LATEST"
    break
  fi

  # A build terminar não quer dizer que o serviço subiu. Ver `verificar_subiu()` acima.
  if PROBLEMA=$(verificar_subiu); then
    echo "$(date -Is) [deploy] $LATEST no ar -- estaveis: $ALVOS" >> ~/logs/deploy.log
  else
    echo "$(date -Is) [deploy] SUBIU QUEBRADO em $LATEST --$PROBLEMA" >> ~/logs/deploy.log
    avisar "SUBIU QUEBRADO em ${LATEST:0:8} --$PROBLEMA -- ver: docker compose logs --tail 80"
    # Não há rollback automático aqui, e isso é deliberado: as imagens anteriores ficam sem tag
    # depois do `up`, então "voltar" exigiria guardar id de imagem por serviço e reescrever o
    # compose — mecanismo novo, com seu próprio jeito de falhar calado. O que faltava era ALGUÉM
    # SABER; reverter é decisão humana com o log na mão.
    break
  fi

  # ── Podar CACHE, e depois CONFERIR o disco ──────────────────────────────────
  #
  # Era `--reserved-space 10GB`, e a flag faz o oposto do que o nome sugere a quem tem pressa:
  # ela é o mínimo que a poda SEMPRE PRESERVA, não o teto do que pode sobrar. O cache cresceu a
  # cada deploy apesar de podar em todos eles, e cada poda liberava pouco — o que foi lido como
  # "não há mais o que liberar" e virou a conclusão errada de que o servidor estava no limite.
  #
  # Em 16/09 o disco chegou a **100%** e o Postgres entrou em laço de PANIC no checkpoint
  # ("could not write to file pg_logical/replorigin_checkpoint.tmp: No space left on device") —
  # sem espaço nem para terminar a própria recuperação. Um `docker builder prune -af` liberou
  # **66,95 GB**: o espaço estava lá o tempo todo.
  #
  # `--max-used-space` é a flag que expressa a intenção (teto do cache). Mas confiar na flag foi
  # exatamente o erro anterior, então a verificação não é a documentação: é o `df` depois.
  docker builder prune -f --max-used-space 15GB
  # A cada rebuild a imagem anterior perde a tag. `image prune -f` só remove o que já não tem tag
  # nenhuma; não há rollback por imagem antiga aqui (ver acima), então nada depende delas.
  docker image prune -f

  # Evidência acima de flag: se o disco continua apertado depois da poda normal, a poda normal não
  # bastou — e o próximo deploy é justamente quem vai precisar do espaço. Escalonar em silêncio
  # seria repetir o defeito, então avisa.
  USO=$(df --output=pcent / | tail -1 | tr -dc '0-9')
  if [ "${USO:-0}" -ge 85 ]; then
    echo "$(date -Is) [deploy] disco em ${USO}% apos poda normal -- escalando para prune -af" >> ~/logs/deploy.log
    docker builder prune -af
    USO_DEPOIS=$(df --output=pcent / | tail -1 | tr -dc '0-9')
    echo "$(date -Is) [deploy] disco ${USO}% -> ${USO_DEPOIS}% apos descartar o cache inteiro" >> ~/logs/deploy.log
    avisar "disco estava em ${USO}% -- cache de build inteiro descartado (agora ${USO_DEPOIS}%)"
  fi
done
