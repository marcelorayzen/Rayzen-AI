@echo off
setlocal EnableExtensions EnableDelayedExpansion

title Rayzen AI - Notebook
cd /d "%~dp0"

set "PNPM=pnpm.cmd"
set "POSTGRES_WAIT_TRIES=90"
set "MIGRATE_RETRIES=5"

echo.
echo  Rayzen AI - subindo notebook (Postgres + Redis + LiteLLM + API + ngrok + agente)...
echo.

where %PNPM% >nul 2>nul
if errorlevel 1 ( echo  ERRO: pnpm nao encontrado. & pause & exit /b 1 )
where docker >nul 2>nul
if errorlevel 1 ( echo  ERRO: docker nao encontrado. & pause & exit /b 1 )
where ngrok >nul 2>nul
if errorlevel 1 ( echo  ERRO: ngrok nao encontrado. & pause & exit /b 1 )

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node" 2^>nul') do set NODE_MAJOR=%%v
if not "%NODE_MAJOR%"=="20" if not "%NODE_MAJOR%"=="22" (
    echo  ERRO: Node.js 20 ou 22 necessario ^(encontrado: %NODE_MAJOR%^).
    pause & exit /b 1
)

if not exist ".env" ( echo  ERRO: .env nao encontrado. & pause & exit /b 1 )
copy /y ".env" "apps\api\.env" >nul

if not exist "node_modules" (
    echo  Instalando dependencias...
    call %PNPM% install --frozen-lockfile
    if errorlevel 1 ( echo  ERRO: pnpm install falhou. & pause & exit /b 1 )
)

echo  Subindo Postgres e Redis...
docker compose up -d postgres redis
if errorlevel 1 ( echo  ERRO: docker compose falhou. & pause & exit /b 1 )

echo  Reiniciando LiteLLM (aplica config atual)...
docker compose restart litellm
if errorlevel 1 ( echo  ERRO: litellm restart falhou. & pause & exit /b 1 )

echo  Aguardando PostgreSQL (porta 55432)...
set /a pg_tries=%POSTGRES_WAIT_TRIES%
:wait_postgres
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ok = (Test-NetConnection -ComputerName 'localhost' -Port 55432 -WarningAction SilentlyContinue).TcpTestSucceeded; if ($ok) { exit 0 } else { exit 1 }" >nul 2>nul
if not errorlevel 1 goto postgres_ready
set /a pg_tries-=1
if !pg_tries! LEQ 0 ( echo  ERRO: PostgreSQL nao respondeu. & pause & exit /b 1 )
timeout /t 2 /nobreak >nul
goto wait_postgres
:postgres_ready

echo  Aguardando LiteLLM (porta 4100)...
set /a llm_tries=60
:wait_litellm
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ok = (Test-NetConnection -ComputerName 'localhost' -Port 4100 -WarningAction SilentlyContinue).TcpTestSucceeded; if ($ok) { exit 0 } else { exit 1 }" >nul 2>nul
if not errorlevel 1 goto litellm_ready
set /a llm_tries-=1
if !llm_tries! LEQ 0 ( echo  AVISO: LiteLLM demorou — continuando. & goto litellm_ready )
timeout /t 2 /nobreak >nul
goto wait_litellm
:litellm_ready

echo  Prisma generate...
call %PNPM% --filter api db:generate
if errorlevel 1 ( echo  ERRO: prisma generate falhou. & pause & exit /b 1 )

echo  Aplicando migrations...
set /a migrate_tries=%MIGRATE_RETRIES%
:migrate_retry
call %PNPM% db:migrate
if not errorlevel 1 goto migrate_ok
set /a migrate_tries-=1
if !migrate_tries! LEQ 0 ( echo  ERRO: migrate falhou. & pause & exit /b 1 )
timeout /t 5 /nobreak >nul
goto migrate_retry
:migrate_ok

echo  Liberando porta 3101...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort 3101 -State Listen -EA SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -EA SilentlyContinue }"
timeout /t 2 /nobreak >nul

echo  Compilando API...
call %PNPM% --filter api build
if errorlevel 1 ( echo  ERRO: build da API falhou. & pause & exit /b 1 )

echo.
echo  Iniciando API, ngrok e agente...
echo.

start "Rayzen API" powershell.exe -NoProfile -NoExit -ExecutionPolicy Bypass -Command "Set-Location -LiteralPath '%CD%'; $env:API_PORT='3101'; $env:REDIS_URL='redis://localhost:56379'; pnpm.cmd --filter api start"
timeout /t 5 /nobreak >nul

start "Rayzen Tunnel" powershell.exe -NoProfile -NoExit -ExecutionPolicy Bypass -Command "ngrok http 3101"

start "" /B powershell.exe -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File "%~dp0apps\agent\watchdog.ps1"

echo  API:    http://localhost:3101  ^(janela "Rayzen API"^)
echo  Tunnel: janela "Rayzen Tunnel" — copie a URL HTTPS do ngrok
echo  Agente: background ^(log em apps\agent\agent.log^)
echo.
echo  Pressione qualquer tecla para fechar esta janela ^(API e ngrok continuam rodando^).
pause >nul
exit /b 0
