# Hermes Agent — container próprio para o SPIKE da Track A.
#
# Não existe imagem Docker oficial: a instalação documentada é
# `curl -fsSL .../install.sh | bash`, e o script puxa Python 3.11, Node v26, ripgrep e
# ffmpeg. Rodar isso direto no H81 colocaria um toolchain inteiro fora do compose, fora
# do inventário de backup, e com crescimento de disco fora da contabilidade do Docker —
# que é exatamente onde este servidor já foi mordido (54 GB de build cache, 2026-09-05).
#
# Aqui dentro, o mesmo software fica: declarado, descartável, e MENSURÁVEL — o `docker
# stats` e o `docker system df` deste container são o footprint que a matriz de
# comparação pede e que nenhum dos três candidatos publica.
#
# Decisão de 2026-09-06: container próprio em vez de instalar no host.
FROM debian:bookworm-slim

# O instalador exige git, curl e xz-utils.
#
# `build-essential` também — e isso CONTRARIA a documentação, que o lista como necessário
# apenas para o app desktop. Medido em 2026-09-06: o build falhou com
# "No C++ compiler found ... node steps that compile native modules (e.g. node-pty) will
# fail". O instalador tenta resolver sozinho com apt e não consegue, porque a essa altura
# já não roda como root.
#
# Custo real, MEDIDO em 16/09 com `docker history` — a afirmação anterior ("engorda a imagem de
# forma significativa") era impressão, e ela induziu a uma proposta errada de multi-stage:
#
#   2,95 GB  instalação do Hermes  ← o peso é aqui, e é o produto
#    351 MB  este apt inteiro (git, curl, xz-utils, ca-certificates, build-essential)
#    240 MB  Node
#     85 MB  debian base
#
# Multi-stage recuperaria no máximo uma fração dos 351 MB — `git` e `curl` seguem necessários em
# runtime para o auto-update do próprio Hermes. Não vale o rebuild: a imagem é de 5,3 GB porque o
# Hermes é de 5,3 GB.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git curl xz-utils ca-certificates build-essential \
    && rm -rf /var/lib/apt/lists/*

# ── Node na IMAGEM, e não dentro do diretório de dados (H1) ───────────────────
#
# O instalador do Hermes baixa o Node para `$HERMES_HOME/node` quando não o encontra no
# PATH — e `$HERMES_HOME` é justamente o diretório que precisa virar volume para a conversa
# sobreviver à recriação. Sem isto, o volume carregaria **230 MB de runtime** e congelaria a
# versão do Node: volume nomeado já populado não recebe o conteúdo de uma imagem nova, então
# o conserto de persistência anularia o pin de versão.
#
# Com o Node no PATH, o instalador reporta "Node.js vX found" e não baixa nada.
ARG NODE_VERSION=26.8.2
RUN curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
      | tar -xJ -C /opt && mv "/opt/node-v${NODE_VERSION}-linux-x64" /opt/node
ENV PATH="/opt/node/bin:${PATH}"

# Usuário sem privilégio: o Hermes vai receber um token de LEITURA do Rayzen, e não há
# motivo para o processo poder mais que isso no próprio container.
RUN useradd -m -s /bin/bash hermes

# O PAI, nunca o próprio diretório de instalação: o instalador RECUSA um destino que já
# exista e não seja um clone git ("Directory exists but is not a git repository").
RUN mkdir -p /opt/hermes && chown hermes:hermes /opt/hermes

USER hermes
WORKDIR /home/hermes

# A instalação vem de um script remoto. Até 13/09 esta camada era fixada só pela DATA do
# build, com o comentário anterior afirmando que "o `install.sh` não expõe pin" — e isso
# **estava errado**: o script aceita `--commit SHA` ("Pin checkout to a specific commit
# after clone/update"), além de `--branch`. Conferido lendo o próprio instalador.
#
# O risco não era teórico. O rebuild de 13/09 trouxe **v0.21.2 (2026.9.11)**, mais nova que
# a do spike de 08/09, e com ela um schema de configuração diferente (0 → 44) que deixou o
# `config.yaml` versionado obsoleto sem nada acusar em runtime. Desta vez a versão nova era
# melhor; a mesma mecânica poderia ter trazido uma que não sobe.
#
# `HERMES_COMMIT` é o pin. Para atualizar: troque o SHA, rebuild, e rode
# `hermes config check` — se acusar versão de schema, migre o `config.yaml` antes de
# considerar a atualização concluída.
#
# `--dir` separa CÓDIGO de ESTADO, e é caso de uso previsto pelo próprio instalador: *"Data,
# config, sessions, and logs still live in $HERMES_HOME … This keeps Docker bind-mounted volumes
# small"*. Sem isso, `~/.hermes` mistura 1,7 GB de checkout com 52 MB de estado, e não há como
# persistir um sem congelar o outro.
#
# O executável fica em `~/.local/bin/hermes` — FORA de `~/.hermes`, verificado —, então o volume
# montado sobre o diretório de dados não o esconde.
ARG HERMES_COMMIT=422bc9bde9d212ab3741fbc45a871a3938436d59
RUN curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash -s -- \
      --commit "${HERMES_COMMIT}" --dir /opt/hermes/agent

ENV PATH="/home/hermes/.local/bin:${PATH}"

# ── A UI do navegador é CONSTRUÍDA aqui, não em runtime ──────────────────────
#
# `hermes serve` e `hermes dashboard` são coisas diferentes, e eu confundi as duas em 17/09: o
# help do `serve` diz *"Headless: it never opens a browser UI"*, que eu li como "não abre janela"
# quando significa **não serve UI**. Com `serve` no ar, o login funcionava (a página de login vem
# do middleware de autenticação, não do app) e abrir a raiz devolvia:
#
#     {"error":"Headless backend (hermes serve): web UI disabled — use `hermes dashboard` ..."}
#
# `dashboard` é a UI. Sem `dist`, ele faz `npm install` + build **a cada subida** — e o destino
# (`hermes_cli/web_dist`) fica FORA do volume `~/.hermes`, então seria refeito a cada recriação de
# container. Medido antes de assar: o build leva **9,33s** e produz **3,2 MB**; o `node_modules`
# do web soma 11 MB. Barato na imagem, desperdício em runtime.
#
# O runtime passa `--skip-build`, que encontra este dist — confirmado no log:
# "Skipping web UI build (--skip-build); using dist at /opt/hermes/agent/hermes_cli/web_dist".
RUN cd /opt/hermes/agent/web  && PATH=/opt/node/bin:$PATH npm install --no-audit --no-fund  && PATH=/opt/node/bin:$PATH npm run build  && test -f /opt/hermes/agent/hermes_cli/web_dist/index.html

# ── Identidade e config entram por LINK, não por bind de arquivo ──────────────
#
# O entrypoint refaz os dois links a cada subida. O motivo longo está no próprio script: bind de
# arquivo aponta para o inode, `git pull` troca o inode, e a identidade congelaria na primeira vez
# que fosse editada — sem erro e sem aviso.
# `--chmod` em vez de um `RUN chmod` depois: a essa altura o build já roda como `hermes`, que não
# escreve em `/usr/local/bin`. O COPY em si é feito pelo builder, não pelo USER corrente.
COPY --chmod=0755 entrypoint.sh /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

# Reserva: o comando real vem do compose (`hermes dashboard`). Este CMD só vale se alguém rodar a
# imagem sem compose, e manter o container de pé para `docker exec` continua sendo útil.
CMD ["sleep", "infinity"]
