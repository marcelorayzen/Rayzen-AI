# H1 — o que sobrevive à recriação do Hermes

Data: 13/09/2026 · medido no spike em execução, depois de H0.

**Critério C08:** o perfil conversa, reinicia, é recriado, e a pendência/continuidade sobrevive.

---

## 1. Diagnóstico: hoje não sobrevive quase nada

A auditoria (R7) observou que o volume monta **apenas** `~/.hermes/memories` e que a documentação
upstream situa as sessões em `state.db`, fora dali. Com o container rodando, deu para medir em vez
de inferir — e é mais amplo do que sessões.

Conteúdo de `~/.hermes/` e o que dele é persistido:

| item | o que é | persistido? |
|---|---|---|
| `state.db` (294 KB) | **sessões de conversa** | ❌ |
| `sessions/` | diretório de sessões | ❌ |
| `.env` (26 KB) | configuração gerada, chaves | ❌ |
| `auth.json` | credenciais de provedor | ❌ |
| `SOUL.md` | prompt de identidade | ❌ |
| `skills/` (14 entradas) | skills disponíveis | ❌ |
| `cron/` · `hooks/` · `pairing/` | configuração operacional | ❌ |
| `backups/` · `logs/` | histórico local | ❌ |
| `memories/` | caderno pessoal (MEMORY.md/USER.md) | ✅ **e está vazio** |

**A prova, não a inferência:** `hermes sessions` depois do recreate das 19:22 lista **uma única
sessão** — a de 19:25. As conversas de 16h e 18h, feitas em H0, sumiram. O único diretório
persistido (`memories/`) não tem nada dentro.

> **Efeito prático:** cada `up -d --force-recreate` do spike zera a memória operacional inteira do
> Hermes. Isso torna C08 impossível por construção — e também explica por que "montar `memories/`"
> nunca foi suficiente: o comentário do compose dizia *"memória e estado"*, mas só a primeira
> metade estava lá.

### Um achado lateral sobre identidade

O `SOUL.md` que existe em `~/.hermes/` é o **prompt padrão da Nous Research** (668 bytes, sobre
tom e concisão), não o `core/identity/SOUL.md` do repositório do Rayzen. São arquivos homônimos e
sem relação.

Isso confirma, por outro caminho, a observação da auditoria de que não foi localizado carregador do
SOUL do repositório: o Hermes tem o seu, gerado na instalação. A pergunta de identidade de H2
continua aberta — e agora com um nome concreto para o que hoje ocupa esse lugar.

## 2. Por que não basta montar `~/.hermes` inteiro

O diretório mistura **código instalado** e **estado**:

| | tamanho |
|---|---|
| `hermes-agent/` (o checkout do código) | **1,7 GB** |
| `node/` (runtime) | **230 MB** |
| todo o resto (o estado de fato) | **57 MB** |

Um volume sobre `~/.hermes` inteiro guardaria o código instalado — e, como volume nomeado já
populado não recebe o conteúdo de uma imagem nova, **congelaria a versão do Hermes no volume**,
anulando o pin de commit recém-introduzido. O conserto de persistência mataria o conserto de
versão.

## 3. A saída é prevista pelo upstream

O instalador aceita separar as duas coisas, e a própria ajuda diz para quê:

```
--dir PATH          Installation directory
--hermes-home PATH  Data directory (default: ~/.hermes, or $HERMES_HOME)

  Data, config, sessions, and logs still live in $HERMES_HOME ...
  This keeps Docker bind-mounted volumes small
```

Com o código em `/opt/hermes-agent`, `~/.hermes` passa a conter só estado (~57 MB), e aí pode ser
um volume inteiro sem prender a versão. O executável fica em `~/.local/bin/hermes`, **fora** de
`~/.hermes` — verificado, então o volume não o esconde.

## 4. O que o build de teste ensinou — duas coisas, nenhuma óbvia

**`--dir` recusa um diretório pré-criado.** `mkdir -p /opt/hermes-agent` no Dockerfile faz o
instalador parar com *"Directory exists but is not a git repository"*: ele quer criar o próprio
clone. Cria-se o **pai** (`/opt/hermes`), nunca o destino.

**`node/` NÃO acompanha o código.** Mesmo com `--dir`, o log mostra
`Extracting to ~/.hermes/node/` — 230 MB de runtime dentro do diretório de dados. Era o risco
levantado em §3, e ele se confirmou.

A saída: instalar o Node **na imagem** (`/opt/node`, no PATH). Aí o instalador reporta
`Node.js v26.8.2 found` e não baixa nada. O runtime deixa de entrar no volume, e a versão do Node
passa a ser propriedade da imagem, como git e curl.

## 5. Desenho aplicado

| arquivo | mudança |
|---|---|
| `infra/hermes/Dockerfile` | Node 26.8.2 em `/opt/node` (ARG versionado) · `mkdir` só do pai · `--dir /opt/hermes/agent` |
| `infra/hermes/docker-compose.hermes.yml` | volume **`hermes-home`** em `/home/hermes/.hermes` inteiro, no lugar de `hermes-data` em `memories/` |

Resultado medido na imagem nova: `~/.hermes` passa de **1,9 GB (código+runtime+estado)** para
**52 MB de estado puro** — sem `hermes-agent/`, sem `node/`.

Volume **novo** em vez de reaproveitar `hermes-data`: o antigo fica intocado como ponto de
retorno, e não custa nada porque está vazio. O bind `:ro` do `config.yaml` continua funcionando
dentro do volume (mount mais específico sobrepõe) — testado, não presumido.

## 6. C08 — validado com o teste que importa

Container de teste, volume nomeado, ciclo completo:

| passo | resultado |
|---|---|
| conversa: *"Guarde este número: 4271"* | sessão `20260914_005219_abbd78` criada |
| `hermes sessions list` antes | ✅ lista a sessão |
| **`docker rm -f` + subir de novo** | volume preservado |
| `hermes sessions list` depois | ✅ **a mesma sessão, mesmo id** |
| `hermes --resume <id> -z "Qual número eu pedi para guardar?"` | ✅ **`4271.`** |

A última linha é a que fecha o critério. Listar a sessão prova que o arquivo sobreviveu; **retomar
e lembrar** prova que a continuidade sobreviveu — que é o que C08 pede e o que o Hermes precisa
ter para ser a camada de conversa.

> **O pin se justificou uma quarta vez.** O `upstream` reportado pelo binário foi `422bc9bd`,
> `5dea46d1`, `b9271bcb` e agora `85e32fcd` — quatro commits diferentes em um único dia, com
> `local` fixo em `422bc9bd` nos três últimos builds.

## 7. Estado

| item | estado |
|---|---|
| build com `--dir` + Node na imagem | ✅ validado em imagem descartável |
| `~/.hermes` = só estado | ✅ 52 MB |
| C08 (conversa sobrevive ao recreate) | ✅ incluindo retomada com memória |
| aplicado no spike em execução | ❌ **ainda não** — o container roda o layout antigo |
| artefatos de teste | ✅ removidos (container, volume, imagem, `/tmp`) |

**Continua aberto:** `skills/`, `cron/` e `hooks/` agora vivem no volume, então builtins novos de
uma versão futura do Hermes não chegarão sozinhos a um volume já populado — é o trade-off conhecido
de volume nomeado. Não morde hoje (nenhum deles está em uso) e tem saída conhecida
(`hermes doctor --fix`, `hermes skills`), mas é dívida declarada, não resolvida.

**Não validado:** start/stop/restart repetidos, dois perfis em paralelo, e o comportamento do
`gateway` — H1 cobriu recriação, que era a pergunta da auditoria.
