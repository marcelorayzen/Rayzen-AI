$ROOT = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$LOG  = Join-Path $PSScriptRoot "agent.log"

while ($true) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content $LOG "[$ts] iniciando agente..."

    Set-Location $ROOT
    & pnpm.cmd --filter agent start

    $ts   = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $code = $LASTEXITCODE
    Add-Content $LOG "[$ts] agente saiu (code=$code). Reiniciando em 5s..."
    Start-Sleep -Seconds 5
}
