#!/usr/bin/env bash
#
# ── Por que a identidade não pode ser um bind de ARQUIVO ─────────────────────
#
# Até 15/09 o compose montava dois arquivos, um a um:
#
#     ../../core/identity/rayzen.soul.md:/home/hermes/.hermes/SOUL.md:ro
#     ./config.yaml:/home/hermes/.hermes/config.yaml:ro
#
# Bind de arquivo aponta para o **inode**, não para o caminho. E `git pull` não reescreve o
# arquivo no lugar: escreve um novo e renomeia por cima. Medido no próprio servidor em 15/09, com
# um repositório temporário:
#
#     inode antes do pull:  97273
#     inode depois do pull: 97299   conteudo=v2
#
# Ou seja: a "identidade única" funcionaria exatamente até a primeira vez que alguém a editasse.
# Do primeiro deploy em diante o container seguiria lendo o conteúdo antigo — sem erro, sem aviso,
# com o arquivo aparentemente montado. Pior que não ter unificado, porque passa a existir a
# crença de que há uma fonte só.
#
# Bind de DIRETÓRIO não tem esse problema: o inode do diretório é estável, e o arquivo lá dentro é
# resolvido pelo caminho a cada leitura. O link simbólico dentro do volume aponta para esse
# caminho, então toda leitura de `$HERMES_HOME/SOUL.md` chega ao arquivo que está no disco AGORA.
#
# `ln -sfn` toda subida, em vez de uma vez na mão: o volume é estado persistente, e estado
# persistente ajustado manualmente é estado que ninguém sabe reconstruir.
set -euo pipefail

HERMES_HOME="${HERMES_HOME:-/home/hermes/.hermes}"
mkdir -p "$HERMES_HOME"

# `-f` remove o que estiver no lugar (inclusive um arquivo regular sobrando do arranjo antigo);
# `-n` impede que, com o link já existindo e apontando para um diretório, o novo link seja criado
# DENTRO dele em vez de substituí-lo.
ln -sfn /opt/rayzen/identity/rayzen.soul.md "$HERMES_HOME/SOUL.md"
ln -sfn /opt/rayzen/conf/config.yaml        "$HERMES_HOME/config.yaml"

# Falhar aqui é melhor que subir com identidade ausente: sem SOUL o Hermes responde com a
# personalidade do modelo base, que é indistinguível de "está funcionando" para quem olha de fora.
# Mesmo modo de falha do `TELEGRAM_API_TOKEN` que nunca existiu.
for alvo in "$HERMES_HOME/SOUL.md" "$HERMES_HOME/config.yaml"; do
  if [ ! -r "$alvo" ]; then
    echo "[hermes] FATAL: $alvo nao resolve para um arquivo legivel — o bind de diretorio sumiu?" >&2
    exit 1
  fi
done

echo "[hermes] identidade: $(wc -c < "$HERMES_HOME/SOUL.md") bytes via $(readlink "$HERMES_HOME/SOUL.md")"

# ── `USER.md` é SEMENTE, não link ───────────────────────────────────────────
#
# O SOUL e o `config.yaml` entram por link porque são fonte única: o repositório manda, o
# container obedece. `USER.md` é o oposto — o Hermes ESCREVE nele (`memory.write_approval: true`
# deixa a escrita em estágio, revisável por `/memory pending`). Um link `:ro` quebraria isso.
#
# Então o repositório guarda só como o arquivo COMEÇA, e `cp` sem sobrescrever garante que uma
# recriação de container não apague o que o Hermes aprendeu. A divergência aqui é por desenho, ao
# contrário da do SOUL — e é por isso que este é o único dos três que não é link.
#
# Sem a semente, `USER.md` simplesmente não existia (conferido em 15/09): o Hermes começava sem
# saber nada sobre Marcelo, e um caderno vazio convida a preencher.
MEMORIAS="$HERMES_HOME/memories"
mkdir -p "$MEMORIAS"
if [ ! -e "$MEMORIAS/USER.md" ] && [ -r /opt/rayzen/identity/USER.md ]; then
  cp /opt/rayzen/identity/USER.md "$MEMORIAS/USER.md"
  echo "[hermes] USER.md semeado a partir do repositorio ($(wc -c < "$MEMORIAS/USER.md") bytes)"
else
  echo "[hermes] USER.md: $( [ -e "$MEMORIAS/USER.md" ] && echo "ja existe, preservado" || echo 'semente ausente' )"
fi

# ── O hash da senha entra em BASE64, e a razão é um defeito real (18/09) ────
#
# O hash scrypt tem a forma `scrypt$16384$8$1$<sal>$<dk>` — **cinco cifrões**. O Docker Compose
# interpola `${VAR}` e também `$NOME` nos valores que vêm do `.env`, então `$16384`, `$8` e `$1`
# foram substituídos por vazio no caminho até o container:
#
#     no .env:      86 caracteres, 5 cifrões
#     no container: 23 caracteres, 3 cifrões
#
# O efeito é o pior possível: o Hermes SOBE normalmente (username presente + hash não-vazio bastam
# para o provedor registrar), o portão de autenticação engata, e **toda senha do mundo é recusada**
# — inclusive a certa. Login impossível, para sempre, sem nada no log.
#
# Base64 não tem `$`, então atravessa intacto. E a validação abaixo é o que impede o silêncio: se o
# que chegar aqui não for um hash scrypt bem formado, o container **não sobe**. Trocar "não consigo
# entrar, e não sei por quê" por "o container não subiu" é a diferença entre defeito e sintoma.
if [ -n "${HERMES_DASHBOARD_BASIC_AUTH_PASSWORD_HASH_B64:-}" ]; then
  HASH=$(printf %s "$HERMES_DASHBOARD_BASIC_AUTH_PASSWORD_HASH_B64" | base64 -d 2>/dev/null || true)

  # 6 campos separados por `$`, o primeiro sendo `scrypt` — a forma que `hash_password` produz.
  CAMPOS=$(printf %s "$HASH" | awk -F'$' '{print NF}')
  ESQUEMA=$(printf %s "$HASH" | cut -d'$' -f1)
  if [ "$ESQUEMA" != "scrypt" ] || [ "${CAMPOS:-0}" -ne 6 ]; then
    echo "[hermes] FATAL: HERMES_DASHBOARD_BASIC_AUTH_PASSWORD_HASH_B64 nao decodifica para um hash scrypt" >&2
    echo "[hermes]        esquema='${ESQUEMA}' campos='${CAMPOS}' tamanho=${#HASH}" >&2
    echo "[hermes]        subir assim recusaria TODA senha, inclusive a certa, sem nada no log." >&2
    exit 1
  fi
  export HERMES_DASHBOARD_BASIC_AUTH_PASSWORD_HASH="$HASH"
  echo "[hermes] senha do HUB: hash scrypt de ${#HASH} bytes carregado do base64"
elif [ -n "${HERMES_DASHBOARD_BASIC_AUTH_USERNAME:-}" ]; then
  # Username sem hash é o estado que o Hermes trata com um aviso e segue — aqui não. Um HUB que
  # sobe sem senha e fica exposto é pior que um HUB que não sobe.
  echo "[hermes] FATAL: HERMES_DASHBOARD_BASIC_AUTH_USERNAME definido sem _PASSWORD_HASH_B64" >&2
  exit 1
fi

exec "$@"
