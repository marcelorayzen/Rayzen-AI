param(
  [switch]$Watchdog  # usa watchdog com auto-restart (recomendado)
)

$ROOT = Split-Path $PSScriptRoot -Parent
if ($PSScriptRoot -eq '') { $ROOT = (Get-Location).Path }
else { $ROOT = $PSScriptRoot }

$ENV_FILE = Join-Path $ROOT ".env"
if (Test-Path $ENV_FILE) {
  Get-Content $ENV_FILE | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)=(.*)$') {
      $key = $Matches[1].Trim()
      $val = $Matches[2].Trim()
      if (-not [System.Environment]::GetEnvironmentVariable($key)) {
        [System.Environment]::SetEnvironmentVariable($key, $val, 'Process')
      }
    }
  }
}

# Força role do notebook — identifica este agente para o sistema de roteamento
$env:AGENT_ROLE = 'notebook'

Write-Host ""
Write-Host " Rayzen Agent — Notebook"
Write-Host " Role   : $env:AGENT_ROLE"
Write-Host " API    : $env:AGENT_API_URL"
Write-Host " Polling: a cada $($env:AGENT_POLL_INTERVAL_MS ?? '3000')ms"
Write-Host ""
Write-Host " Este agente recebe tarefas exclusivas do notebook (ex: restart_api)"
Write-Host ""

Set-Location $ROOT

if ($Watchdog) {
  Write-Host " Iniciando com watchdog (auto-restart em falha)..."
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ROOT "apps\agent\watchdog.ps1")
} else {
  & pnpm.cmd --filter agent start
}
