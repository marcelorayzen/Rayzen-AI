# Roda DENTRO da conta RayzenExec. Disparado por `sessao-isolada-lancar.ps1`, que roda como
# o dono e nunca entra aqui.
#
# ## O contrato deste arquivo
#
# Tudo o que ele precisa saber chega por PARAMETRO (caminhos) ou por ARQUIVO (conteudo).
# Nenhum prompt, nome de ferramenta ou caminho de projeto e montado dentro de uma string de
# comando -- e o mesmo principio de `executar-helper.ts`: o argv carrega o caminho do helper,
# que e constante, e o payload entra pelo canal de dados.
#
# O prompt em particular e texto de terceiro por definicao. Ele viaja como arquivo, e chega ao
# `claude` como UM elemento de um array de argumentos, entregue pelo operador de chamada. Nao
# ha ponto onde um `;` ou um `$( )` dentro dele possa ser lido como comando. Medido em 11/09
# com prompt contendo `; && | $(whoami)` e crase: voltou literal.
#
# ## Por que o resultado volta por arquivo
#
# `Start-Process -Credential -Wait` devolve ACESSO NEGADO ao tentar monitorar um processo de
# outra conta -- medido em 09/09, depois de o processo ter rodado ate o fim. O lado do dono
# nao consegue observar nem o codigo de saida nem o stdout deste processo. Entao o resultado
# e ESCRITO, e quem le e o dono, pelo `C:\RayzenExec\logs`, onde ele tem leitura.

param(
    [Parameter(Mandatory)][ValidateSet('preparar','executar','entregar')][string]$Acao,
    [Parameter(Mandatory)][string]$Trabalho,   # diretorio no canal publico com os dados de entrada
    [Parameter(Mandatory)][string]$Workspace,  # clone proprio da conta
    [Parameter(Mandatory)][string]$Log,        # saida ao vivo -- o dono le enquanto cresce
    [Parameter(Mandatory)][string]$Res,        # resultado chave=valor
    [Parameter(Mandatory)][string]$Feito,      # marcador final
    [Parameter(Mandatory)][string]$Marca       # GUID desta execucao
)

$ErrorActionPreference = 'Continue'

function Reg([string]$k, $v) { Add-Content -LiteralPath $Res -Value ("$k=$v") -Encoding utf8 }

# `Add-Content` linha a linha, e NAO `Tee-Object`/`Out-File` com handle aberto. Duas razoes,
# medidas em 11/09:
#   1. Tee-Object do PowerShell 5.1 nao aceita `-Encoding` e grava UTF-16. Anexado a um arquivo
#      UTF-8, o resultado tem duas codificacoes dentro: cresce, e le como lixo. Cresceu sem
#      dizer nada -- a pior forma de errar aqui.
#   2. Abrir e fechar a cada linha garante que nunca ha handle preso. E do que depende o dono
#      conseguir acompanhar o log do outro lado da fronteira de conta.
function Emitir([string]$linha) { Add-Content -LiteralPath $Log -Value $linha -Encoding utf8 }

function Git { (Get-Command git -ErrorAction SilentlyContinue).Source }

Set-Content -LiteralPath $Res -Value ('quem=' + (whoami)) -Encoding utf8
Reg 'acao' $Acao

$git = Git
if (-not $git) { $git = 'C:\Program Files\Git\cmd\git.exe' }
if (-not (Test-Path $git)) { Reg 'erro' 'git nao encontrado'; Set-Content -LiteralPath $Feito -Value $Marca -Encoding ascii; exit 1 }

if (-not (Test-Path $Workspace)) {
    Reg 'erro' "workspace ausente: $Workspace"
    Set-Content -LiteralPath $Feito -Value $Marca -Encoding ascii
    exit 1
}
Set-Location -LiteralPath $Workspace

switch ($Acao) {

    # ---- PREPARAR: por a arvore da conta no mesmo commit que a do dono ------------------
    # Sem isto a sessao trabalha sobre o codigo do dia do clone. O do dono em 11/09 estava
    # NOVE commits a frente do clone de 09/09 -- uma sessao ali produziria patch contra um
    # passado, e o `bundle verify` do dono acusaria depois, tarde demais.
    #
    # `fetch` de um bundle, nao `pull` de um remoto: a conta nao tem credencial de git, e o
    # clone teve o `origin` removido de proposito no passo 3 (um remoto que aponta para um
    # bundle apagado e um `pull` que mente).
    'preparar' {
        $bundle = Join-Path $Trabalho 'base.bundle'
        $ramo   = (Get-Content -LiteralPath (Join-Path $Trabalho 'ramo.txt') -Raw -Encoding UTF8).Trim()
        if (-not (Test-Path $bundle)) { Reg 'erro' 'bundle de base ausente'; break }

        Emitir "preparando workspace no ramo $ramo"
        & $git fetch --quiet $bundle 'main:refs/rayzen/base' 2>&1 | ForEach-Object { Emitir $_ }
        $ok = ($LASTEXITCODE -eq 0)
        Reg 'fetch_exit' $LASTEXITCODE

        if ($ok) {
            # `-B` reseta o ramo da sessao para a base. Uma sessao comeca do estado do dono,
            # nunca de sobra de sessao anterior.
            & $git checkout -B $ramo 'refs/rayzen/base' 2>&1 | ForEach-Object { Emitir $_ }
            Reg 'checkout_exit' $LASTEXITCODE
            # Arquivo nao rastreado de sessao anterior nao pertence a esta. `-d` remove
            # diretorio; `-x` NAO entra, para nao apagar `node_modules` a cada sessao.
            & $git clean -fd 2>&1 | Out-Null
        }
        Reg 'head' (& $git rev-parse --short HEAD)
        Reg 'ramo' (& $git rev-parse --abbrev-ref HEAD)
    }

    # ---- EXECUTAR: a sessao do Claude, dentro da conta ----------------------------------
    'executar' {
        $prompt = Get-Content -LiteralPath (Join-Path $Trabalho 'prompt.txt') -Raw -Encoding UTF8

        # Uma linha por padrao, vindo do TypeScript: FERRAMENTAS_PERMITIDAS e FERRAMENTAS_NEGADAS
        # continuam sendo a fonte unica. Duplicar a lista aqui seria duas listas divergindo, que
        # e como um valida contra uma coisa e o outro roda contra outra.
        $permitidas = @(Get-Content -LiteralPath (Join-Path $Trabalho 'permitidas.txt') -Encoding UTF8 | Where-Object { $_ })
        $negadas    = @(Get-Content -LiteralPath (Join-Path $Trabalho 'negadas.txt')    -Encoding UTF8 | Where-Object { $_ })

        $npm = Join-Path $env:APPDATA 'npm'
        if (Test-Path $npm) { $env:PATH = "$npm;$env:PATH" }

        # Array de argumentos, entregue por splat. Cada elemento chega ao processo como UM
        # argv -- o PowerShell nao reinterpreta o conteudo deles.
        $argumentos = @('-p', $prompt)
        if ($permitidas.Count -gt 0) { $argumentos += '--allowedTools';    $argumentos += $permitidas }
        if ($negadas.Count    -gt 0) { $argumentos += '--disallowedTools'; $argumentos += $negadas }

        Reg 'ferramentas_permitidas' $permitidas.Count
        Reg 'ferramentas_negadas'    $negadas.Count
        Reg 'prompt_bytes'           ([Text.Encoding]::UTF8.GetBytes($prompt).Length)

        # O commit que a sessao vai fazer apaga o proprio rastro para um `git diff HEAD`. Por
        # isso o ponto de comparacao e capturado ANTES -- ver o bloco do diff, abaixo.
        $antes = (& $git rev-parse HEAD).Trim()
        Reg 'head_antes' $antes

        # `$null |` fecha o stdin. Sem isso o CLI espera 3s por entrada que nunca vem e avisa
        # "no stdin data received in 3s" -- inofensivo por iteracao, 60s desperdicados num laco
        # de 20. O prompt ja viaja por `-p`; nao ha nada para ler na entrada padrao.
        $t0 = Get-Date
        $null | & claude @argumentos 2>&1 | ForEach-Object { Emitir $_ }
        Reg 'claude_exit' $LASTEXITCODE
        Reg 'claude_ms'   ([int]((Get-Date) - $t0).TotalMilliseconds)
        Reg 'head_depois' (& $git rev-parse HEAD)

        # O diff do card de aprovacao precisa nascer AQUI. O dono nao roda git nesta arvore:
        # o proprio git recusa com "dubious ownership", e a sugestao dele -- `safe.directory` --
        # desfaria parte do isolamento, porque um `.git/config` escrito por esta conta passaria
        # a ser executado com a identidade de quem revisa. Escrever o diff num arquivo que o
        # dono LE e o caminho que respeita a fronteira.
        #
        # A comparacao e contra o HEAD DE ANTES DA ETAPA, nunca contra `HEAD`. Medido em 11/09
        # na validacao ponta a ponta: a sessao criou o arquivo, commitou, e `git diff --stat HEAD`
        # devolveu VAZIO -- assim como `git status --short`, porque nao sobrou nada fora do
        # commit. O card ficaria em branco exatamente no passo que produziu codigo, que e o pior
        # momento possivel para nao ter o que mostrar a quem aprova.
        $d = & $git diff --stat $antes
        if (-not $d) { $d = & $git status --short }
        Set-Content -LiteralPath ($Res + '.diff') -Value ($d -join [Environment]::NewLine) -Encoding utf8
    }

    # ---- ENTREGAR: o trabalho atravessa como DADO, nunca como repositorio ---------------
    # O dono nao roda git dentro da arvore desta conta: o proprio git recusa com "dubious
    # ownership", e com razao -- um `.git/config` escrito aqui seria executado com a
    # identidade de quem rodasse o comando. O bundle atravessa a fronteira como arquivo.
    #
    # Incremental (`base..HEAD`), nunca completo: um bundle completo "aplicaria" mesmo se as
    # bases tivessem divergido, escondendo a divergencia. O incremental declara o
    # pre-requisito, e o `bundle verify` do dono o checa contra o repositorio dele.
    'entregar' {
        $base   = (Get-Content -LiteralPath (Join-Path $Trabalho 'base.txt')   -Raw -Encoding UTF8).Trim()
        $destino= (Get-Content -LiteralPath (Join-Path $Trabalho 'bundle.txt') -Raw -Encoding UTF8).Trim()

        & $git add -A 2>&1 | Out-Null
        $sujo = & $git status --porcelain
        if ($sujo) {
            # Commit de fechamento: trabalho nao commitado nao entra num bundle, e sumiria
            # em silencio no `git clean` da proxima sessao.
            & $git commit -m 'chore(sessao): trabalho nao commitado pela sessao supervisionada' 2>&1 | ForEach-Object { Emitir $_ }
        }

        Reg 'head' (& $git rev-parse --short HEAD)
        $novos = & $git rev-list --count "$base..HEAD"
        Reg 'commits' $novos

        if ([int]$novos -eq 0) {
            # Zero commit nao e erro: a sessao pode ter terminado sem produzir codigo. Um
            # bundle vazio, esse sim, seria um arquivo que promete trabalho e nao entrega.
            Reg 'bundle' ''
            Emitir 'nenhum commit novo -- nada a entregar'
            break
        }

        New-Item -ItemType Directory -Path (Split-Path $destino -Parent) -Force | Out-Null
        & $git bundle create $destino "$base..HEAD" 2>&1 | ForEach-Object { Emitir $_ }
        Reg 'bundle_exit' $LASTEXITCODE
        if ($LASTEXITCODE -eq 0) { Reg 'bundle' $destino } else { Reg 'bundle' '' }

        # Retencao: o dono tem so LEITURA no outbox e nao consegue limpar. Quem apaga precisa
        # ser este lado, que tem Modify. Mantem os 20 mais recentes -- por contagem, nao por
        # tamanho: bundle incremental tem ~1 KB e o numero de entregas e o que cresce.
        $outbox = Split-Path $destino -Parent
        Get-ChildItem -LiteralPath $outbox -Filter '*.bundle' -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -Skip 20 |
            ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
    }
}

Reg 'fim' 'ok'
Set-Content -LiteralPath $Feito -Value $Marca -Encoding ascii
