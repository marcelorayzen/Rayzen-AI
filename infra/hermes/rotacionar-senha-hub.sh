#!/usr/bin/env bash
# Gera a senha do HUB, PROVA que o login funciona, e so entao entrega.
#
# A ordem e o produto. Em 18/09 a senha foi gerada, o hash foi para o .env e a senha foi entregue
# -- e o login era impossivel: o Compose tinha comido os cifroes do hash. Provar o NEGATIVO (senha
# errada recusada) e inferir o positivo nao e provar; um portao que recusa tudo passa nesse teste.
#
# Aqui a senha so vai para o Telegram DEPOIS de um login real devolver 200.
set -uo pipefail
cd ~/projects/rayzen-ai

TG_TOKEN=$(grep -m1 '^TELEGRAM_BOT_TOKEN=' .env | cut -d= -f2-)
TG_CHAT=$(grep -m1 '^TELEGRAM_CHAT_ID=' .env | cut -d= -f2-)
USUARIO=$(grep -m1 '^HERMES_DASHBOARD_BASIC_AUTH_USERNAME=' .env | cut -d= -f2-)
[ -n "$TG_TOKEN" ] && [ -n "$TG_CHAT" ] && [ -n "$USUARIO" ] || { echo "faltam variaveis no .env"; exit 1; }

GERADO=$(docker exec rayzen-hermes-spike /opt/hermes/agent/venv/bin/python -c '
import secrets, sys
sys.path.insert(0, "/opt/hermes/agent")
from plugins.dashboard_auth.basic import hash_password
pw = secrets.token_urlsafe(18)
print(pw); print(hash_password(pw))
')
SENHA=$(printf %s "$GERADO" | sed -n 1p)
HASH=$(printf %s "$GERADO" | sed -n 2p)
unset GERADO
[ ${#SENHA} -ge 20 ] || { echo "senha curta, abortando"; exit 1; }
case "$HASH" in scrypt\$*) : ;; *) echo "hash malformado, abortando"; exit 1 ;; esac

cp .env .env.bak-rotacao-$(date +%Y%m%d-%H%M%S)
B64=$(printf %s "$HASH" | base64 -w0)
sed -i '/^HERMES_DASHBOARD_BASIC_AUTH_PASSWORD_HASH_B64=/d' .env
echo "HERMES_DASHBOARD_BASIC_AUTH_PASSWORD_HASH_B64=$B64" >> .env
echo ">>> hash gravado em base64 (${#B64} chars, $(printf %s "$B64" | tr -cd '$' | wc -c) cifroes)"

echo ">>> recriando o HUB"
docker compose -f infra/hermes/docker-compose.hermes.yml --env-file .env up -d hermes >/dev/null 2>&1
for i in $(seq 1 30); do
  curl -sf --max-time 3 http://127.0.0.1:9119/api/health >/dev/null 2>&1 && break
  sleep 3
done

echo ">>> o hash chegou inteiro?"
docker exec rayzen-hermes-spike sh -c 'printf "    no container: %s bytes, %s cifroes\n" "${#HERMES_DASHBOARD_BASIC_AUTH_PASSWORD_HASH}" "$(printf %s "$HERMES_DASHBOARD_BASIC_AUTH_PASSWORD_HASH" | tr -cd "\$" | wc -c)"'

echo ">>> PROVA: login com a senha CERTA"
CODIGO=$(curl -s -o /tmp/login-prova.txt -w '%{http_code}' --max-time 15 \
  -X POST http://127.0.0.1:9119/auth/password-login \
  -H 'Content-Type: application/json' \
  --data "$(printf '{"provider":"basic","username":"%s","password":%s,"next":"/"}' "$USUARIO" \
            "$(printf %s "$SENHA" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')")")

if [ "$CODIGO" != "200" ]; then
  echo "    FALHOU: HTTP $CODIGO — $(head -c 120 /tmp/login-prova.txt)"
  echo "    A senha NAO foi entregue. O .env ficou com o hash novo; investigar antes de repetir."
  rm -f /tmp/login-prova.txt; unset SENHA; exit 1
fi
echo "    login respondeu 200"
rm -f /tmp/login-prova.txt

echo ">>> e a senha ERRADA continua recusada?"
CERR=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X POST http://127.0.0.1:9119/auth/password-login \
  -H 'Content-Type: application/json' -d '{"provider":"basic","username":"'"$USUARIO"'","password":"errada","next":"/"}')
echo "    senha errada: HTTP $CERR"
[ "$CERR" = "401" ] || { echo "    ESPERAVA 401 — nao entrego senha com o portao em estado duvidoso"; unset SENHA; exit 1; }

TEXTO="Senha do HUB (nova)

usuario: ${USUARIO}
senha: ${SENHA}

A anterior NAO funcionava: o Docker Compose comeu os cifroes do hash e o login
era impossivel. Esta foi testada de verdade antes de ser enviada -- login
devolveu 200 e senha errada devolveu 401.

Guarde no gerenciador e apague esta mensagem."
TG=$(curl -s -o /dev/null -w '%{http_code}' -X POST "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" \
  -H 'Content-Type: application/json' \
  --data "$(printf '{"chat_id":"%s","text":%s}' "$TG_CHAT" \
            "$(printf %s "$TEXTO" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')")")
unset SENHA TEXTO
echo ">>> telegram: HTTP $TG"
