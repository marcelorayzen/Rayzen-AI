# Roda como `marce`, SEM elevacao. MEDE o transporte da Fase 4-B antes de implementa-la.
#
# A sessao supervisionada hoje faz `spawn('claude')` como o dono, le stdout por PIPE e espera
# o codigo de saida do processo. Rodando na conta RayzenExec nenhuma das tres coisas continua
# valendo de graca:
#
#   - nao ha pipe: `Start-Process -Credential` nao devolve stdout ao processo pai;
#   - nao ha codigo de saida: `-Wait` da ACESSO NEGADO ao monitorar processo de outra conta
#     (medido em 09/09, script 3) -- o resultado precisa voltar por arquivo;
#   - o prompt nao pode virar linha de comando: seria a interpolacao que o plano de execucao
#     tipada existe para eliminar.
#
# Este script mede as tres, mais a latencia por iteracao, numa unica ida a conta. Nao altera
# codigo, nao move sessao, nao toca o repositorio -- so escreve no canal publico e apaga depois.

param(
    [string]$Senha = (Join-Path $env:USERPROFILE 'rayzenexec-senha.txt'),
    [string]$Drop  = 'C:\Users\Public\rayzen-drop'
)

$ErrorActionPreference = 'Stop'

$raiz = 'C:\RayzenExec'
$logs = Join-Path $raiz 'logs'
$ws   = Join-Path $raiz 'workspaces\rayzen-ai'
$repo = Split-Path $PSScriptRoot -Parent

if (-not (Test-Path $Senha)) { Write-Error "Arquivo de senha nao encontrado: $Senha"; exit 1 }
if (-not (Test-Path $ws))    { Write-Error "Workspace da conta nao existe: $ws"; exit 1 }

$marca  = [guid]::NewGuid().ToString()
$res    = Join-Path $logs 'sonda-sessao.res'
$fluxo  = Join-Path $logs 'sonda-sessao.fluxo'
$saida  = Join-Path $logs 'sonda-sessao.claude'
$feito  = Join-Path $logs 'sonda-sessao.done'

New-Item -ItemType Directory -Path $Drop -Force | Out-Null
$promptFile = Join-Path $Drop 'sonda-sessao.prompt.txt'
$auxFile    = Join-Path $Drop 'rayzenexec-9-sonda-na-conta.ps1'

# ---- O prompt: dado com metacaractere e acento, de proposito --------------------------
# Metacaractere porque o caminho novo nao pode interpreta-lo em ponto nenhum; acento porque
# PowerShell 5.1 le arquivo sem BOM na codepage ANSI e corromperia em silencio. Montado por
# codigo de ponto para que ESTE arquivo continue ASCII puro -- nao-ASCII em .ps1 lido como
# ANSI ja quebrou o autostart em 06/09.
$cedilha = [char]0x00E7
$atil    = [char]0x00E3
$eco     = 'ECO-OK ; && | $(whoami) `hostname` "aspas" ' + "implementa${cedilha}${atil}o"

$linhas = @(
    '[PROTOCOLO RAYZEN - obrigatorio]'
    'Ao final da resposta, escreva em linha propria UM marcador: [[RAYZEN:DONE]] quando concluir.'
    ''
    'Tarefa (nao use ferramenta nenhuma, apenas responda):'
    '1. Repita em uma linha, EXATAMENTE e sem alterar nada, o texto entre <<< e >>>:'
    "<<<$eco>>>"
    '2. Na linha seguinte, escreva o marcador [[RAYZEN:DONE]].'
)
$prompt = $linhas -join "`r`n"

# WriteAllText, nao Set-Content: Set-Content acrescenta uma quebra de linha no fim, e o SHA
# dos dois lados deixaria de casar por um byte que ninguem escreveu.
[IO.File]::WriteAllText($promptFile, $prompt, (New-Object Text.UTF8Encoding $true))
$shaEsperado = ([BitConverter]::ToString(
    [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($prompt))
)).Replace('-','').ToLower()

Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'rayzenexec-9-sonda-na-conta.ps1') -Destination $auxFile -Force

# Canal publico e legivel por qualquer conta local por padrao. Como `marce` e owner dos
# arquivos recem-criados, da para restringir sem elevacao.
try {
    $sidExec = (Get-LocalUser -Name 'RayzenExec').SID.Value
    foreach ($f in @($promptFile, $auxFile)) {
        & icacls $f /inheritance:r | Out-Null
        & icacls $f /grant:r "$($env:USERNAME):(R,W)" "*${sidExec}:(R)" | Out-Null
    }
} catch {
    Write-Warning "Nao consegui restringir o ACL do canal: $($_.Exception.Message)"
}

$sec  = ConvertTo-SecureString (Get-Content $Senha -Raw).Trim() -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential("$env:COMPUTERNAME\RayzenExec", $sec)

Write-Output "sondando o transporte dentro da conta RayzenExec (marca $($marca.Substring(0,8)))..."
Write-Output ''

# `$args` seria a variavel automatica do PowerShell -- nome proprio, como em `$action` do
# autostart (06/09), onde a colisao deu um erro que falava de outra coisa.
$argumentos = @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$auxFile`"",
    '-Res', "`"$res`"", '-Fluxo', "`"$fluxo`"", '-SaidaClaude', "`"$saida`"",
    '-Prompt', "`"$promptFile`"", '-Workspace', "`"$ws`"",
    '-Feito', "`"$feito`"", '-Marca', $marca
)
try {
    Start-Process -FilePath 'powershell.exe' -ArgumentList $argumentos `
                  -Credential $cred -WorkingDirectory $raiz -WindowStyle Hidden -ErrorAction Stop
} catch {
    # Nao aborta: o processo pode ter subido mesmo assim. Quem decide e a marca.
    Write-Output "aviso do Start-Process: $($_.Exception.Message)"
}

# ---- MEDICAO 1: o dono le o log ENQUANTO a conta escreve? ----------------------------
# FileShare::ReadWrite e exatamente o modo que o Node usa ao ler um arquivo -- se falhar
# aqui, falha no agent tambem. Tamanhos distintos vistos ANTES do marcador final sao a
# evidencia de leitura ao vivo; ver o arquivo so depois de pronto nao e streaming.
$tamanhos     = New-Object System.Collections.Generic.HashSet[long]
$errosLeitura = @()
$ausente      = 0
$limite       = (Get-Date).AddMinutes(6)
$concluiu     = $false

while ((Get-Date) -lt $limite) {
    try {
        $fs = [IO.File]::Open($fluxo, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
        [void]$tamanhos.Add($fs.Length)
        $fs.Close()
    } catch [System.IO.FileNotFoundException] {
        $ausente++          # a conta ainda nao criou -- nao e falha de compartilhamento
    } catch {
        $errosLeitura += $_.Exception.GetType().Name
    }

    if ((Test-Path $feito) -and ((Get-Content $feito -Raw -ErrorAction SilentlyContinue).Trim() -eq $marca)) {
        $concluiu = $true
        break
    }
    Start-Sleep -Milliseconds 300
}

$tamanhosVivos = $tamanhos.Count

Remove-Item $promptFile, $auxFile -Force -ErrorAction SilentlyContinue

# ---- Leitura do resultado ------------------------------------------------------------
$r = @{}
if (Test-Path $res) {
    foreach ($l in (Get-Content -LiteralPath $res -Encoding utf8)) {
        # `[a-z0-9_]`: a primeira versao usava `[a-z_]` e engolia `prompt_sha256` calado --
        # o valor chegava, a chave e que nao casava, e o veredito saia FALHA por falta dele.
        if ($l -match '^([a-z0-9_]+)=(.*)$') { $r[$Matches[1]] = $Matches[2] }
    }
}

# Tres estados, como os invariantes do sistema: quem nao conseguiu medir nao devolve sucesso,
# e tambem nao devolve falha. `INCONCL` e a leitura do dono quando a conta nem chegou a
# escrever o fluxo -- reprovar ali culparia o lado errado.
function Linha([string]$nome, [bool]$ok, [string]$detalhe, [bool]$mediu = $true) {
    $tag = if (-not $mediu) { 'INCONCL ' } elseif ($ok) { 'OK      ' } else { 'FALHA   ' }
    Write-Output ("  $tag $nome".PadRight(46) + $detalhe)
}

Write-Output '== medicao =='
if (-not $concluiu) {
    Write-Warning 'A conta nao sinalizou conclusao -- o que segue pode estar parcial.'
}

Linha 'a conta executou'          ($r.ContainsKey('quem'))                  $r['quem']
Linha 'perfil e o da conta'       ($r['userprofile'] -like '*RayzenExec*')  $r['userprofile']
Linha 'workspace proprio'         ($r['workspace_ok'] -eq 'sim')            $ws
$escreveu = ($r['fluxo_linhas'] -as [int]) -gt 0
Linha 'log legivel AO VIVO'       ($tamanhosVivos -ge 3)                    "$tamanhosVivos tamanhos distintos; ausente $ausente x; erros: $(if ($errosLeitura) { ($errosLeitura | Select-Object -Unique) -join ',' } else { 'nenhum' })" $escreveu
Linha 'fluxo chegou completo'     ($r['fluxo_linhas'] -eq '8')              "$($r['fluxo_linhas']) de 8 linhas"
Linha 'prompt integro (sha256)'   ($r['prompt_sha256'] -eq $shaEsperado)    "$($r['prompt_bytes']) bytes"
Linha 'codigo de saida voltou'    ($r.ContainsKey('claude_exit'))           "exit=$($r['claude_exit'])"
Linha 'claude respondeu'          ($r['claude_exit'] -eq '0')               "$($r['claude_ms']) ms"
Linha 'marcador de protocolo'     ($r['marcador'] -eq 'DONE')               $r['marcador']
Linha 'metacaractere literal'     ($r['eco_literal'] -eq 'sim')             'eco devolvido sem interpretacao'

Write-Output ''
if ($r['prompt_sha256'] -ne $shaEsperado) {
    Write-Output "  esperado: $shaEsperado"
    Write-Output "  recebido: $($r['prompt_sha256'])"
}
if (Test-Path $saida) {
    Write-Output '== resposta do claude (ultimas linhas) =='
    Get-Content -LiteralPath $saida -Encoding utf8 | Select-Object -Last 12 | ForEach-Object { "  $_" }
}
Write-Output ''
Write-Output 'Arquivos da sonda ficam em C:\RayzenExec\logs (so a conta apaga).'
