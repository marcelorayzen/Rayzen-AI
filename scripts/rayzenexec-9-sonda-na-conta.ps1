# Roda DENTRO da conta RayzenExec, disparado por rayzenexec-9-sondar-sessao.ps1.
#
# Nao e um teste de seguranca -- e uma MEDICAO do transporte que a Fase 4-B precisa ter.
# Responde quatro perguntas que hoje sao suposicao, gravando o resultado em um arquivo
# chave=valor que o dono le depois (ele nao consegue observar o processo desta conta).
#
# Tudo o que este script sabe chega por PARAMETRO. Nada e interpolado em linha de comando:
# e o mesmo principio do plano de execucao tipada -- o prompt e DADO, nunca texto para
# alguem interpretar.

param(
    [Parameter(Mandatory)][string]$Res,        # resultado chave=valor (a conta escreve, o dono le)
    [Parameter(Mandatory)][string]$Fluxo,      # arquivo de stream: o dono tenta ler ENQUANTO cresce
    [Parameter(Mandatory)][string]$SaidaClaude,# saida bruta da chamada do claude
    [Parameter(Mandatory)][string]$Prompt,     # arquivo com o prompt (dado, nao argumento de shell)
    [Parameter(Mandatory)][string]$Workspace,  # clone proprio da conta
    [Parameter(Mandatory)][string]$Feito,      # marcador final
    [Parameter(Mandatory)][string]$Marca       # GUID desta execucao -- marcador velho nao vale
)

$ErrorActionPreference = 'Continue'

function Reg([string]$k, $v) { Add-Content -LiteralPath $Res -Value ("$k=$v") -Encoding utf8 }

Set-Content -LiteralPath $Res -Value ('quem=' + (whoami)) -Encoding utf8
Reg 'userprofile' $env:USERPROFILE
Reg 'appdata'     $env:APPDATA
Reg 'temp'        $env:TEMP

# ---- 1) STREAMING -------------------------------------------------------------------
# Um processo filho de verdade emitindo linhas ao longo do tempo, com a saida atravessando
# um pipeline ate o arquivo -- que e a forma da chamada real do `claude`. A pergunta nao e
# se o arquivo existe no fim: e se o DONO consegue abri-lo e ver crescer no meio do caminho.
Set-Content -LiteralPath $Fluxo -Value '' -Encoding utf8
$emissor = '1..8 | ForEach-Object { Write-Output ("linha " + $_ + " " + (Get-Date -Format HH:mm:ss.fff)); Start-Sleep -Milliseconds 900 }'
# `Add-Content` linha a linha, e NAO `Tee-Object`. Duas razoes, as duas medidas em 11/09:
#
#   1. Tee-Object do PowerShell 5.1 nao aceita `-Encoding` e grava UTF-16. Anexando num
#      arquivo criado em UTF-8, o resultado e um arquivo com DUAS codificacoes dentro: o
#      tamanho cresce, a leitura ao vivo funciona, e nenhuma linha casa com o padrao
#      esperado. Cresceu sem dizer nada -- a pior forma de errar por aqui.
#   2. Add-Content abre e fecha a cada linha, entao nunca ha handle preso: e o que o log da
#      sessao precisa ter para o dono conseguir acompanhar do outro lado da fronteira.
& powershell.exe -NoProfile -Command $emissor 2>&1 |
    ForEach-Object { Add-Content -LiteralPath $Fluxo -Value $_ -Encoding utf8 }
Reg 'fluxo_linhas' (@(Get-Content -LiteralPath $Fluxo | Where-Object { $_ -match '^linha ' })).Count

# ---- 2) O PROMPT ATRAVESSOU BYTE A BYTE? --------------------------------------------
# -Encoding UTF8 e obrigatorio: sem isso o PowerShell 5.1 le arquivo sem BOM na codepage
# ANSI e acento vira outro byte -- o SHA do dono acusaria, que e exatamente o ponto.
$p = Get-Content -LiteralPath $Prompt -Raw -Encoding UTF8
$bytes = [Text.Encoding]::UTF8.GetBytes($p)
$sha = ([BitConverter]::ToString(
          [Security.Cryptography.SHA256]::Create().ComputeHash($bytes))).Replace('-','').ToLower()
Reg 'prompt_bytes'  $bytes.Length
Reg 'prompt_sha256' $sha

# ---- 3) O CLAUDE RESPONDE NA CONTA, PELO CAMINHO NOVO? ------------------------------
$npm = Join-Path $env:APPDATA 'npm'
if (Test-Path $npm) { $env:PATH = "$npm;$env:PATH" }

if (Test-Path $Workspace) {
    Set-Location -LiteralPath $Workspace
    Reg 'workspace_ok' 'sim'
} else {
    Reg 'workspace_ok' 'NAO'
}

$t0 = Get-Date
# O prompt vai como ARGUMENTO do operador de chamada: o PowerShell entrega a string ao
# processo sem reinterpretar. Metacaractere dentro dela e texto, nao comando.
$saida = & claude -p $p --allowedTools Read Glob Grep --disallowedTools 'Bash(rm:*)' 'Bash(git push:*)' 2>&1 | Out-String
$codigo = $LASTEXITCODE
Reg 'claude_exit' $codigo
Reg 'claude_ms'   ([int]((Get-Date) - $t0).TotalMilliseconds)

Set-Content -LiteralPath $SaidaClaude -Value $saida -Encoding utf8

# ---- 4) O MARCADOR DE PROTOCOLO SOBREVIVEU AO CAMINHO NOVO? -------------------------
if ($saida -match '\[\[RAYZEN:([A-Z_]+)\]\]') { Reg 'marcador' $Matches[1] } else { Reg 'marcador' 'AUSENTE' }

# Eco literal: se o metacaractere tivesse sido interpretado em algum ponto, ele nao voltaria
# igual no texto da resposta.
if ($saida -match 'ECO-OK') { Reg 'eco_literal' 'sim' } else { Reg 'eco_literal' 'nao' }

Reg 'fim' 'ok'
Set-Content -LiteralPath $Feito -Value $Marca -Encoding ascii
