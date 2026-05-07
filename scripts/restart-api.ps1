param(
  [string]$Branch = "local/marcelo",
  [int]$Port      = 3101
)

$ROOT = Split-Path $PSScriptRoot -Parent
$LOG  = Join-Path $ROOT "apps\agent\agent.log"

function Log($msg) {
  $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $line = "[$ts] [restart-api] $msg"
  Add-Content $LOG $line
  Write-Host $line
}

Set-Location $ROOT
Log "Iniciando restart da API (branch=$Branch, porta=$Port)..."

# 1. git pull
Log "git pull origin $Branch..."
$pull = & git pull origin $Branch 2>&1
Log $pull
if ($LASTEXITCODE -ne 0) { Log "ERRO: git pull falhou."; exit 1 }

# 2. build da API
Log "Compilando API..."
& pnpm.cmd --filter api build 2>&1 | ForEach-Object { Log $_ }
if ($LASTEXITCODE -ne 0) { Log "ERRO: build falhou."; exit 1 }

# 3. matar processo na porta
Log "Encerrando processo na porta $Port..."
Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

# 4. subir API em background
Log "Subindo API em background..."
Start-Process powershell.exe -WindowStyle Hidden -ArgumentList `
  "-NoProfile -ExecutionPolicy Bypass -Command `"Set-Location -LiteralPath '$ROOT'; `$env:API_PORT='$Port'; `$env:REDIS_URL='redis://localhost:56379'; pnpm.cmd --filter api start`""

Start-Sleep -Seconds 3
$running = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($running) {
  Log "API reiniciada com sucesso na porta $Port."
  exit 0
} else {
  Log "AVISO: API pode ainda estar subindo. Verifique em alguns segundos."
  exit 0
}
