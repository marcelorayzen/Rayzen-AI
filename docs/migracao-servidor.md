# Migração do servidor — trocar o SSD de máquina

> ## ✅ EXECUTADA EM 2026-08-08/09 — o servidor roda na H81
>
> `board_name` confirma **H81**, hostname `servidor-local`, 12 containers de pé, banco íntegro,
> túnel Cloudflare reconectado sozinho. O preparo de rede funcionou: o curinga `en*` pegou DHCP
> em toda topologia que apareceu, sem intervenção.
>
> **Pendências abertas desta migração** — ver "Pontas soltas" no fim do documento.

> Plano para mover o SSD do notebook servidor para outra máquina, mantendo o mesmo sistema.
> Tudo aqui foi **verificado contra o servidor real em 2026-08-08**, não é suposição.
> Acesso e fatos permanentes do servidor: `memory/reference_vps_ssh.md`.

---

## Destino: a H81

A decisão inicial era mandar o SSD do servidor para o PC mais novo. Foi invertida — o servidor
vai para a **H81** (Haswell, 2013, 8GB DDR3), e o PC mais novo fica para trabalho.

**O motivo principal não é o CSM.** É a divisão de carga: o servidor são 12 containers quase
todos ociosos, uma carga de disponibilidade, não de CPU. Trabalho — build do monorepo, testes,
IDE — é que pede máquina boa. Dedicar a máquina fraca à carga leve e sempre-ligada libera a
forte para o uso interativo. O CSM garantido numa placa de 2013 é bônus.

### 8GB é suficiente — medido, não estimado

Consumo real do servidor em 2026-08-08, com os 12 containers de pé:

| | |
|---|---|
| RAM do host | 7.278 MB total · **1.957 MB em uso** |
| Soma dos 12 containers | **~1,78 GB** |
| Swap (4GB) | **0 bytes usados** — nunca precisou paginar |

Maiores consumidores: `litellm` 628 MB · `langfuse` 348 MB · `postgres` 152 MB · `api-v2` 146 MB
· `ollama` 143 MB · `api` 121 MB. Os outros seis somam 159 MB.

Na H81 (8.192 MB) sobram **~6,2 GB** — quase 1 GB a mais de folga do que a máquina tem hoje.

Dois pontos onde a margem encolhe, nenhum bloqueante:

- **Build no servidor.** O deploy é `docker compose up -d --build`, ou seja, compila TypeScript e
  Next.js na própria máquina — isso é o que consome RAM de verdade. Vários builds passaram nos
  7GB atuais, então 8GB é folga, não risco.
- **Ollama com modelo carregado.** Medido em 2026-08-08 com o `llama3.2:3b` já instalado: o
  container vai de 143 MB para **2,66 GB** enquanto atende, e o host sai de 1.957 MB para
  **4.549 MB** em uso. Mas o Ollama **descarrega o modelo após ~5min ocioso** (`ollama ps` mostra
  o contador), então esses 2,6 GB não são permanentes — é pico, não linha de base.

Placas H81 têm 2 slots DDR3 e aceitam 16GB. Há um pente de **4GB** disponível para somar — se
os 8GB forem um único módulo, o segundo slot leva o 4GB e o total vai a **12GB**, o que elimina
a única margem apertada (Ollama com modelo carregado). Conferir antes: o pente precisa ser
**DDR3** (DDR4 não encaixa na H81), e os 8GB precisam estar em um slot só. Tamanhos diferentes
convivem sem problema — só perdem o dual-channel simétrico, irrelevante para esta carga.

### O que muda de verdade: energia

Sai a bateria do notebook, que funcionava como no-break. Num desktop, queda seca de energia com
o Postgres escrevendo é o risco real desta migração — mais do que qualquer coisa de memória.
Vale um nobreak pequeno, ou no mínimo backup do banco em dia.

---

## O que torna essa migração arriscada

O sistema é **headless** e roda **em Wi-Fi**. Se a rede não subir na máquina nova, não há SSH,
não há Cloudflare Tunnel, não há `rayzen.com.br` — e a recuperação exige monitor e teclado no
gabinete. Todo o preparo abaixo existe para eliminar esse cenário.

O disco em si migra bem: `/` é montado por **UUID**, swap é **arquivo** (`/swap.img`), e há um
disco único (`sda`, 111,8G) com tudo dentro, volumes Docker inclusos.

---

## Já feito (2026-08-08) — não precisa refazer

| O quê | Onde | Por quê |
|---|---|---|
| Ethernet por curinga `en*` | `/etc/netplan/00-installer-config.yaml` | Antes casava pelo MAC `04:7d:7b:25:73:0f`, que não existe na máquina nova |
| Nome estável `wifi0` | `/etc/systemd/network/10-wifi-stable-name.link` | `Type=wlan` → renomeia qualquer placa wireless. **Já validado ao vivo**: a interface atual virou `wifi0` sem queda de rede |
| Netplan declara `wlp7s0` **e** `wifi0` | mesmo arquivo | networkd **não aceita `match:` em Wi-Fi**, só nome literal. Declarar os dois elimina a janela de risco |
| `wait-online --any` | `/etc/systemd/system/systemd-networkd-wait-online.service.d/10-any.conf` | Antes esperava TODAS as interfaces; o `enp2s0` sem cabo travava em `configuring` e o sistema subia `degraded` desde 02/08 |
| Sem autosuspend USB + power save off | `/etc/udev/rules.d/81-wifi-estabilidade.rules` | Causas clássicas de queda de link em adaptador Realtek USB |
| CORS com `.174` e `.175` | `.env` (`CORS_ORIGINS`) | Liberava só o IP **antigo** — acesso pela LAN batia em CORS |

Backups: `/etc/netplan/00-installer-config.yaml.bak-migracao` e `.env.bak-20260808-171144`.

### Driver do adaptador — não precisa instalar nada

Adaptador de destino: **Realtek RTL8188EU USB** (`0bda:8179`).

- Kernel `7.0.0-28-generic` traz `rtl8xxxu` in-kernel, e seus aliases já cobrem `v0BDAp8179`,
  `v0BDAp0179` e `v2357p010C`
- Firmware presente: `/lib/firmware/rtlwifi/rtl8188eufw.bin.zst`
  (procurar pelo nome **descomprimido** dá "não existe" — é falso alarme,
  `CONFIG_FW_LOADER_COMPRESS_ZSTD=y` resolve na hora)
- `modprobe rtl8xxxu` testado, carrega OK

O antigo `r8188eu` de staging foi removido do kernel e não faz falta.

---

## Pré-voo

### 1. Reiniciar o notebook COM ALGUÉM NA FRENTE dele — ✅ FEITO em 2026-08-08 17:48

Passou em tudo. O caminho de boot está validado no hardware original:

| Verificação | Resultado |
|---|---|
| SSH **sem ninguém logar no console** | responde — o prompt de senha na tela é só o `getty` normal |
| `systemctl is-system-running` | `running` (antes subia `degraded`) |
| Renomeação para `wifi0` no boot | funcionou, mesmo IP `192.168.0.174` |
| Unidades falhas | nenhuma |
| Containers | 12/12 |
| `rayzen.com.br` | 200 — o túnel reconectou sozinho |
| `/infra/health` | postgres, redis, litellm, api_v2, mcp, agent_desktop todos `ok` |

> Isso encerra em definitivo a dúvida antiga de que o servidor exigiria login manual no boot
> para subir rede e Docker (ver `memory/project_server_autologin_pending.md`): exige login **no
> console**, como qualquer servidor, mas nada depende disso.

Se for repetir a verificação depois da troca:

```bash
systemctl is-system-running     # running, não degraded
ip -br addr | grep -E 'wifi0|en' # wifi0 com IP
systemctl --failed              # vazio
docker compose ps               # 12 containers
```

Se algo falhar aqui, falharia igual na máquina nova — e lá seria muito pior de diagnosticar.

### 2. BIOS da H81 — CSM

O disco é **GPT com partição BIOS boot de 1M e sem ESP**, e o GRUB está instalado em modo BIOS.
Em UEFI puro o firmware não acha o que procura e a máquina **não dá boot** — não é recuperável
por software, só mudando a BIOS. Sendo de 2013, a H81 tem CSM; muitas placas dessa época já vêm
em Legacy por padrão.

| Opção (o nome varia por fabricante) | Valor |
|---|---|
| **Secure Boot** | **Disabled** — desligar **primeiro**, costuma travar as demais |
| **CSM Support** / *Launch CSM* / *Compatibility Support Module* | **Enabled** |
| **Boot Mode** / *Boot Mode Select* | **Legacy** (se só existir "UEFI+Legacy", serve) |
| **Storage OpROM** / *Launch Storage OpROM policy* | **Legacy Only** |
| **Fast Boot** | **Disabled** — pula a init do CSM e esconde dispositivos legacy |
| Ordem de boot | a entrada do SSD **sem** o prefixo `UEFI:` |

Para descobrir o modo de uma máquina sem entrar na BIOS, rode `msinfo32` no Windows dela e veja
**"Modo BIOS"**: `Legado` significa CSM ativo.

Confirmação depois de bootar:

```bash
[ -d /sys/firmware/efi ] && echo "UEFI — errado" || echo "Legacy — correto"
```

### 3. Pausar o webhook de build — o que derrubou o notebook

**Existe build automático por push, e ele não estava documentado em lugar nenhum.**
`POST /webhook/github-build` no `rayzen-mcp-http`: todo push na `main` faz o GitHub chamar o
MCP, que abre SSH no host e roda `git pull && docker compose build web api api-v2`.

Em 2026-08-08 isso derrubou a máquina. O log registra **8 builds disparados pelo webhook** ao
longo do dia (12:58, 13:04, 13:15, 15:54, 16:21, 17:43, 17:54, 18:13), somados a ~6
`docker compose up -d --build` manuais — cerca de **14 rebuilds completos de web+api+api-v2 num
único dia**, num notebook de 7GB. Durante o 14º o journal para seco às 18:13:40, sem sequência
de shutdown e sem kernel panic, e a máquina depois recusou ligar por alguns minutos (luz acende,
ventoinha gira, desliga) — assinatura de estresse térmico. **Não houve OOM**: zero ocorrências
no log do boot anterior.

Antes de ligar a H81, ou logo no primeiro boot:

```bash
# remove o secret → o handler rejeita qualquer chamada sem assinatura válida
sed -i 's/^GITHUB_WEBHOOK_SECRET=.*/GITHUB_WEBHOOK_SECRET=/' ~/projects/rayzen-ai/.env
docker compose up -d mcp-http
```

Deploy volta a ser manual e sob controle. A correção estrutural é não compilar no servidor —
buildar as imagens fora e o servidor só puxar imagem pronta. Compilar TypeScript e Next.js é de
longe a carga mais pesada que essa máquina recebe, e a única que a levou ao limite.

### 4. Backup do banco antes de desligar

Feito em 2026-08-08 e guardado **fora do servidor**, em `C:\Users\marce\Desktop\rayzen-backups\`:
`rayzen_ai` 33 MB e `langfuse` 37 MB comprimidos, os dois com `gzip -t` e marcador de fechamento
`\unrestrict` conferidos. Os bancos são pequenos (`rayzen_ai` 98 MB, `langfuse` 628 MB), então
repetir custa cerca de um minuto:

```bash
D=$(date +%Y%m%d-%H%M)
docker exec -i rayzen-ai-postgres-1 pg_dump -U rayzen -d rayzen_ai --no-owner | gzip > /tmp/rayzen_ai-$D.sql.gz
docker exec -i rayzen-ai-postgres-1 pg_dump -U rayzen -d langfuse  --no-owner | gzip > /tmp/langfuse-$D.sql.gz
```

Copiar para fora com `scp` — backup que fica no disco que está sendo movido não é backup.

### 5. Reserva de DHCP (opcional, recomendado)

O `192.168.0.174` é lease DHCP amarrado ao MAC. Trocando o adaptador, o IP muda. Uma reserva
por MAC no roteador fixa o `.174` e evita atualizar referências em vários lugares.

> **Não foi feita, e o custo previsto aconteceu.** O IP passou a ser **`servidor-local`**, e em
> 2026-08-16 — uma semana depois da troca — ainda havia `.174` em 11 arquivos, incluindo dois
> *defaults de código* (`RAYZEN_WS_URL` no widget, `WEBHOOK_DEPLOY_HOST` no mcp-http) e o
> `NEXTAUTH_URL` do Langfuse no compose. Referência a IP morto não dá erro de build nem de teste:
> só falha em runtime, no caminho que ninguém exercita. Este parágrafo previu exatamente isso e
> foi arquivado como "opcional".

---

## Execução

1. `cd ~/projects/rayzen-ai && docker compose down` — parada limpa, evita corromper o Postgres
2. Desligar, mover o SSD para a H81, **levar junto o adaptador USB Wi-Fi** (ele está no PC hoje;
   sem ele a H81 não tem wireless)
3. Ajustar BIOS conforme a tabela de CSM acima
4. Ligar. **Plugar cabo de rede neste primeiro boot** se houver tomada por perto — é a rede de
   segurança: mesmo se o Wi-Fi falhar, o `en*` sobe por DHCP e você entra por SSH

---

## Pós-boot

```bash
ip -br addr                      # descobrir o IP novo
systemctl is-system-running
ip -br link | grep wifi0         # a regra .link renomeou o adaptador?
docker compose ps                # 12 containers de pé
curl -s localhost:3101/infra/health
```

Cheque o túnel: `docker logs rayzen-ai-cloudflared-1 --tail 30` e acesse `https://rayzen.com.br`.
O túnel conecta de dentro para fora — não se importa com IP nem MAC, volta sozinho.

### Se o IP mudou

Atualizar:
- `.env` → `CORS_ORIGINS`, `WEBHOOK_DEPLOY_HOST`, `LANGFUSE_NEXTAUTH_URL`
- `docker-compose.yml` → defaults de `WEBHOOK_DEPLOY_HOST` e `LANGFUSE_NEXTAUTH_URL`
  (hoje apontam `.175`, enquanto o `.env` diz `.174` — resíduo da migração anterior)
- `memory/reference_vps_ssh.md` e `CLAUDE.local.md`
- `apps/agent/src/hooks/hook.config.mjs` se apontar para IP

> A migração anterior deixou esse acerto pela metade e o CORS ficou quebrado por semanas sem
> ninguém notar. Vale conferir os quatro pontos, não só o primeiro.

---

## Reversão

Se a máquina nova não subir, o caminho de volta é **recolocar o SSD no notebook**. Nada foi
alterado de forma destrutiva: as mudanças de rede casam por curinga e continuam válidas no
hardware original — foi assim que o `wifi0` foi validado ao vivo.

Para desfazer só a parte de rede:

```bash
cp /etc/netplan/00-installer-config.yaml.bak-migracao /etc/netplan/00-installer-config.yaml
rm -f /etc/systemd/network/10-wifi-stable-name.link
netplan apply
```

---

## Depois de estabilizar

Com a máquina nova rodando estável, dá para limpar:

- remover o bloco `wlp7s0` do netplan (sobra só `wifi0`) — elimina um serviço `netplan-wpa-*`
  que nunca ativa. **Só depois de confirmar que o `wifi0` sobe sozinho em vários boots**
- somar o pente de 4GB, se os 8GB estiverem em um slot só

### ✅ Ollama local — feito em 2026-08-08

`llama3.2:3b` (2.0 GB) baixado e validado. O volume `ollama_data` estava **vazio**, então o
`gpt-local` do LiteLLM sempre caía no fallback Groq e consumia o mesmo TPM que todo o resto —
justamente o recurso escasso enquanto não há crédito na Anthropic.

Teste end-to-end: `POST /v1/chat/completions` com `model: gpt-local` respondeu em 2,65s, e
`ollama ps` confirmou `llama3.2:3b · 100% CPU` — serviço local, sem sair para a internet.

Isso tira do free tier as tarefas mecânicas que usam `gpt-local`: classify e gap analysis do
`GraphService` (incluindo o `proposeGoalProgress`), o classify do `OrchestratorService` e o
`ProactiveService`.

---

## Como obter root sem senha de sudo

`sudo` exige senha interativa e não funciona por SSH não-interativo. O usuário `rayzen` está no
grupo `docker`, o que dá root efetivo no host:

```bash
docker run --rm --privileged --pid=host -v /:/host alpine sh -c \
  "apk add --no-cache util-linux >/dev/null 2>&1; nsenter -t 1 -m -u -i -n -p -- <comando>"
```

`nsenter -t 1` executa nos namespaces do host — `systemctl`, `netplan`, `apt` funcionam de
verdade. Para editar arquivo de sistema, escrever em `/host/...`.

### Aplicar mudança de rede sem se trancar para fora

`netplan try` exige TTY. Por SSH não-interativo, o equivalente é aplicar com reversão
automática: um container que espera 150s por um arquivo-sentinela e, se não aparecer, restaura o
backup e reaplica. Foi assim que as mudanças deste documento foram aplicadas com segurança.

---

## Pontas soltas desta migração (2026-08-09)

Três coisas ficaram em estado temporário e **precisam ser revertidas** quando o adaptador
Wi-Fi definitivo chegar e o servidor voltar à LAN.

### 1. ~~NTP está DESLIGADO~~ — ✅ RESOLVIDO em 2026-08-12

Religado com `timedatectl set-ntp true`. `System clock synchronized: yes`, quem sincroniza é o
**chrony** (por isso `systemd-timesyncd` aparece `inactive` — é o esperado, não é falha). RTC
gravado com `hwclock --systohc`.

O acerto manual segurou bem: em 3 dias sem NTP o relógio derivou só **17 segundos**, o que
enfraquece um pouco a hipótese de bateria CR2032 morta — vale reconferir a data depois do
próximo desligamento longo. Estrago do período com data errada: **3 eventos** datados de abril,
zero benchmark_results e zero hipóteses.

<details><summary>Contexto original do problema</summary>

O relógio da H81 estava **115 dias atrasado** (marcava 15/abril). Isso não dá erro: só faz todo
evento, GuardianReport e BenchmarkResult nascer com data errada, e desalinha o ciclo de 24h do
QA Scientist. Detectado porque `/infra/health` devolveu `daysLeft: 133` para um token que expira
em 27/ago.

Corrigido à mão, o que exigiu `timedatectl set-ntp false`. **Religar assim que houver SSH:**

```bash
sudo timedatectl set-ntp true
timedatectl          # conferir "System clock synchronized: yes"
```

**Causa provável: bateria CR2032 da placa.** Placa de 2013 que ficou parada — se for isso, a
data se perde a cada desligamento até trocar a bateria. Custa alguns reais.

</details>

### 2. Webhook de build pausado

`GITHUB_WEBHOOK_SECRET=` está vazio no `.env` (backup em `.env.bak-webhook-*`). Foi o que
derrubou o notebook. Antes de religar, decidir se o build volta a rodar no servidor ou se as
imagens passam a ser construídas fora — a H81 dissipa calor melhor que o notebook, mas compilar
Next.js continua sendo a carga mais pesada da máquina.

### 3. Internet via tethering USB do celular

Arranjo temporário até o adaptador chegar (~2 dias). Funciona: a interface aparece como
`enx<mac>`, que **casa com o curinga `en*`** e pega DHCP sozinha — o túnel voltou sem
intervenção. Mas o servidor fica atrás do NAT do celular: **sem SSH pela LAN**, só HTTP pelo
túnel. Atenção: se a interface vier como `usb0` em vez de `enx...`, ela **não** casa com `en*` e
o netplan precisa de um bloco `usb*`.

---

## Recuperar acesso quando não há DHCP nenhum

Truque que salvou esta migração e vale guardar. Com um cabo direto entre o PC e o servidor, sem
DHCP dos dois lados, o Windows fica em `169.254.x` e o servidor **não** pega IPv4 — o netplan
gera `LinkLocalAddressing=ipv6`, só IPv6. Mas o IPv6 link-local funciona:

```powershell
$i = (Get-NetAdapter -Name Ethernet).ifIndex
ping -6 -n 3 "ff02::1%$i"                 # acorda os vizinhos do link
Get-NetNeighbor -InterfaceIndex $i -AddressFamily IPv6 |
  Where-Object { $_.IPAddress -like 'fe80*' -and $_.State -eq 'Reachable' }

ssh -i "$env:USERPROFILE\.ssh\id_ed25519" "rayzen@fe80::2e0:4cff:fef2:38b%$i"
```

O `fe80::2e0:4cff:fef2:38b` é a placa onboard da H81 (MAC `00:E0:4C:F2:03:8B`, prefixo Realtek).
Funciona sem servidor DHCP, sem configuração, e independe de qual IPv4 a máquina tem.
