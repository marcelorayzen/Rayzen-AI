@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul

title Rayzen AI - Remote Agent Start
cd /d "%~dp0"

set "AUTO_MODE=1"
if /i "%~1"=="--interactive" set "AUTO_MODE=0"

set "PNPM=pnpm.cmd"
set "API_CHECK_TIMEOUT=10"

echo.
echo  Rayzen AI - subindo Agent remoto...
echo.

where %PNPM% >nul 2>nul
if errorlevel 1 (
    echo  ERRO: pnpm nao encontrado no PATH.
    echo  Execute:
    echo    corepack enable
    echo    corepack prepare pnpm@10.33.2 --activate
    goto :fail
)

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node" 2^>nul') do set NODE_MAJOR=%%v
if "%NODE_MAJOR%"=="" (
    echo  ERRO: Node.js nao encontrado no PATH.
    goto :fail
)
if not "%NODE_MAJOR%"=="20" (
    echo  ERRO: Node.js %NODE_MAJOR% detectado, mas este projeto espera Node.js 20 LTS.
    node --version
    goto :fail
)

if not exist ".env" (
    echo  ERRO: .env nao encontrado.
    echo  Use .env.agent.example como base no PC de trabalho.
    goto :fail
)

set "AGENT_API_URL="
set "AGENT_TOKEN="
for /f "tokens=1,* delims==" %%A in (.env) do (
    if /i "%%A"=="AGENT_API_URL" set "AGENT_API_URL=%%B"
    if /i "%%A"=="AGENT_TOKEN" set "AGENT_TOKEN=%%B"
)

if "%AGENT_API_URL%"=="" (
    echo  ERRO: AGENT_API_URL nao definido no .env
    goto :fail
)
if "%AGENT_TOKEN%"=="" (
    echo  ERRO: AGENT_TOKEN nao definido no .env
    goto :fail
)

if not exist "node_modules" (
    echo  Instalando dependencias...
    call %PNPM% install --frozen-lockfile
    if errorlevel 1 (
        echo  ERRO: falha ao instalar dependencias.
        goto :fail
    )
)

echo  Validando acesso ao servidor Rayzen...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$headers = @{ Authorization = 'Bearer %AGENT_TOKEN%' }; try { Invoke-RestMethod -Method Get -Uri '%AGENT_API_URL%/tasks/pending' -Headers $headers -TimeoutSec %API_CHECK_TIMEOUT% | Out-Null; exit 0 } catch { Write-Host ('  ' + $_.Exception.Message); exit 1 }"
if errorlevel 1 (
    echo  ERRO: agent nao conseguiu acessar %AGENT_API_URL%
    echo  Verifique URL publica/tunel e AGENT_TOKEN.
    goto :fail
)

echo.
echo  Iniciando Agent...
echo  API: %AGENT_API_URL%
echo.
call %PNPM% --filter agent build
if errorlevel 1 (
    echo  ERRO: falha ao compilar o agent.
    goto :fail
)

start "Rayzen Remote Agent" powershell.exe -NoProfile -NoExit -ExecutionPolicy Bypass -Command "Set-Location -LiteralPath '%CD%'; pnpm.cmd --filter agent start"

if "%AUTO_MODE%"=="0" pause
exit /b 0

:fail
if "%AUTO_MODE%"=="0" pause
exit /b 1
