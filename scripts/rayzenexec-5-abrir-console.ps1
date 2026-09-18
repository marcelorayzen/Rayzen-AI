# Roda como `marce`, SEM elevacao.
#
# Abre um console VISIVEL ja dentro da conta RayzenExec, no workspace dela, para VOCE fazer
# o login do Claude Code. O login e interativo (device code / navegador) e nao ha como ser
# feito por mim -- nem deveria haver.
#
# O QUE ESTE SCRIPT NAO FAZ
#   - nao copia `~/.claude` do seu perfil (requisito 4). O login e proprio, do zero
#   - nao define ANTHROPIC_API_KEY. Em modo `-p` a chave PREVALECE sobre a assinatura quando
#     presente, entao defini-la anularia exatamente a intencao do teste
#   - nao fecha nem toca na sua sessao
#
# SE O LOGIN NAO FUNCIONAR OU O PLANO RESTRINGIR: pare e me diga o que apareceu. A regra
# acordada e parar e relatar -- nao trocar por API key.

param(
    [string]$Senha = (Join-Path $env:USERPROFILE 'rayzenexec-senha.txt'),
    [string]$Drop  = 'C:\Users\Public\rayzen-drop'
)

$ErrorActionPreference = 'Stop'

$raiz = 'C:\RayzenExec'
$ws   = Join-Path $raiz 'workspaces\rayzen-ai'

if (-not (Test-Path $ws))    { Write-Error "Workspace nao existe: $ws. Rode os passos 1 a 3 antes."; exit 1 }
if (-not (Test-Path $Senha)) { Write-Error "Arquivo de senha nao encontrado: $Senha"; exit 1 }

# O PATH de usuario do perfil alvo NAO e carregado por Start-Process -Credential: ele herda o
# ambiente de SISTEMA. O CLI foi instalado por usuario, entao `claude` nu nao resolve mesmo
# estando instalado -- foi o que reprovou o teste 7 na primeira bateria.
$aux = Join-Path $Drop 'rayzenexec-console.ps1'
@'
$ErrorActionPreference = 'Continue'
$npm = Join-Path $env:APPDATA 'npm'
if (Test-Path $npm) { $env:PATH = "$npm;$env:PATH" }
Set-Location 'C:\RayzenExec\workspaces\rayzen-ai'

Write-Host ''
Write-Host '  Console da conta RayzenExec' -ForegroundColor Cyan
Write-Host ("  usuario: " + (whoami))
Write-Host ("  pasta:   " + (Get-Location).Path)
Write-Host ''
Write-Host '  Para autenticar o Claude Code NESTA conta, rode:' -ForegroundColor Yellow
Write-Host '      claude'
Write-Host ''
Write-Host '  Siga o fluxo de login (device code / navegador) com a SUA assinatura.'
Write-Host '  NAO defina ANTHROPIC_API_KEY: em modo -p a chave prevalece sobre a assinatura.'
Write-Host ''
Write-Host '  Se o login falhar ou o plano recusar duas contas, ANOTE a mensagem e feche.'
Write-Host '  A regra acordada e parar e relatar, nao trocar por API key.'
Write-Host ''
'@ | Set-Content -Path $aux -Encoding utf8

$sec  = ConvertTo-SecureString (Get-Content $Senha -Raw).Trim() -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential("$env:COMPUTERNAME\RayzenExec", $sec)

Write-Output 'abrindo console na conta RayzenExec (janela nova)...'
try {
    Start-Process -FilePath 'powershell.exe' `
                  -ArgumentList '-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$aux`"" `
                  -Credential $cred -WorkingDirectory $raiz -ErrorAction Stop
} catch {
    # `Start-Process -Credential` reclama mesmo quando cria o processo -- medido em 09/09.
    Write-Output "aviso do Start-Process: $($_.Exception.Message)"
}

Write-Output ''
Write-Output 'A janela e da conta RayzenExec. Faca o login por la.'
Write-Output 'Quando terminar, valide com:'
Write-Output '  powershell -ExecutionPolicy Bypass -File scripts\rayzenexec-6-validar-claude.ps1'
Write-Output ''
Write-Output "O arquivo auxiliar fica em $aux enquanto a janela estiver aberta."
Write-Output 'Apague o canal depois: Remove-Item C:\Users\Public\rayzen-drop\* -Force'
