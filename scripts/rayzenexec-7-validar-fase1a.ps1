# Roda como `marce`, SEM elevacao. Executa os 22 do `validar-fase-1a-windows.mjs`
# DENTRO da conta RayzenExec -- o teste 2 do plano.
#
# Nao precisa de `pnpm install` no clone: o validador usa apenas modulos nativos do Node
# (child_process, fs, os, path, url). Node e machine-wide, entao a conta herda.
#
# AVISO SOBRE O CLIPBOARD
# O validador testa `clipboard_write`, entao ele ESCREVE no clipboard e restaura o valor
# anterior no fim. Como o processo roda na mesma window station da sua sessao, o clipboard
# afetado e o SEU. Se voce tiver algo importante copiado agora (a senha da conta, por
# exemplo), cole antes de rodar -- a restauracao existe, mas nao se aposta o que nao se
# pode perder num "existe".

param(
    [string]$Senha = (Join-Path $env:USERPROFILE 'rayzenexec-senha.txt'),
    [string]$Drop  = 'C:\Users\Public\rayzen-drop'
)

$ErrorActionPreference = 'Stop'

$raiz = 'C:\RayzenExec'
$ws   = Join-Path $raiz 'workspaces\rayzen-ai'
$alvo = Join-Path $ws 'scripts\validar-fase-1a-windows.mjs'
$log  = Join-Path $raiz 'logs\validar-fase1a.txt'

if (-not (Test-Path $Senha)) { Write-Error "Arquivo de senha nao encontrado: $Senha"; exit 1 }
if (-not (Test-Path $alvo))  { Write-Error "Validador nao existe no clone: $alvo"; exit 1 }

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }
if (-not (Test-Path $node)) { Write-Error 'node.exe nao encontrado.'; exit 1 }

$marca = [guid]::NewGuid().ToString()
$feito = Join-Path $raiz 'logs\validar-fase1a.done'
$aux   = Join-Path $Drop 'rayzenexec-fase1a.ps1'
@"
`$ErrorActionPreference = 'Continue'
Start-Transcript -Path '$log' -Force | Out-Null
Write-Output ('quem: ' + (whoami))
Set-Location '$ws'
& '$node' '$alvo' --eu-autorizo 2>&1 | ForEach-Object { Write-Output `$_ }
Write-Output ('EXITCODE=' + `$LASTEXITCODE)
Stop-Transcript | Out-Null
Set-Content -Path '$feito' -Value '$marca' -Encoding ascii
"@ | Set-Content -Path $aux -Encoding utf8

$sec  = ConvertTo-SecureString (Get-Content $Senha -Raw).Trim() -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential("$env:COMPUTERNAME\RayzenExec", $sec)

Write-Output 'rodando o validador da Fase 1-A dentro da conta RayzenExec...'
try {
    Start-Process -FilePath 'powershell.exe' `
                  -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$aux`"" `
                  -Credential $cred -WorkingDirectory $raiz -WindowStyle Hidden -ErrorAction Stop
} catch {
    Write-Output "aviso do Start-Process: $($_.Exception.Message)"
}

$limite = (Get-Date).AddMinutes(5)
while ((Get-Date) -lt $limite) {
    if ((Test-Path $feito) -and ((Get-Content $feito -Raw -ErrorAction SilentlyContinue).Trim() -eq $marca)) { break }
    Start-Sleep -Seconds 3
}
if (-not ((Test-Path $feito) -and ((Get-Content $feito -Raw -ErrorAction SilentlyContinue).Trim() -eq $marca))) {
    Write-Warning 'A conta nao sinalizou conclusao em 5 min -- o log pode estar parcial.'
}

Remove-Item $aux -Force -ErrorAction SilentlyContinue

Write-Output ''
if (Test-Path $log) { Get-Content $log } else { Write-Error "Sem log em $log"; exit 1 }
