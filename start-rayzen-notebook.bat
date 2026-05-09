@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul

title Rayzen AI - Iniciando...
cd /d "%~dp0"

set "PNPM=pnpm.cmd"
set "DOCKER_WAIT_TRIES=90"
set "POSTGRES_WAIT_TRIES=90"
set "MIGRATE_RETRIES=5"

echo.
echo  Rayzen AI - subindo tudo no notebook...
echo  (pressione qualquer tecla para continuar ou feche para cancelar)
pause >nul
echo.

where %PNPM% >nul 2>nul
if errorlevel 1 ( echo  ERRO: pnpm nao encontrado. & goto :fail )
where docker >nul 2>nul
if errorlevel 1 ( echo  ERRO: docker nao encontrado. & goto :fail )
where ngrok >nul 2>nul
if errorlevel 1 ( echo  ERRO: ngrok nao encontrado. & goto :fail )

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node" 2^>nul') do set NODE_MAJOR=%%v
if "%NODE_MAJOR%"=="" ( echo  ERRO: Node.js nao encontrado no PATH. & goto :fail )
if not "%NODE_MAJOR%"=="20" if not "%NODE_MAJOR%"=="22" ( echo  ERRO: Node.js 20 ou 22 necessario (encontrado: %NODE_MAJOR%). & goto :fail )

if not exist ".env" ( echo  ERRO: .env nao encontrado. & goto :fail )
copy /y ".env" "apps\api\.env" >nul

if not exist "node_modules" (
    call %PNPM% install --frozen-lockfile
    if errorlevel 1 goto :fail
)

echo  Iniciando Docker Desktop (se nao estiver rodando)...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "if (-not (Get-Process 'Docker Desktop' -EA SilentlyContinue)) { Start-Process 'C:\Program Files\Docker\Docker\Docker Desktop.exe' }"
timeout /t 5 /nobreak >nul

echo  Aguardando Docker Engine...
set /a docker_tries=%DOCKER_WAIT_TRIES%
:wait_docker
docker version >nul 2>nul
if not errorlevel 1 goto docker_ready
set /a docker_tries-=1
if !docker_tries! LEQ 0 ( echo  ERRO: Docker nao respondeu. & goto :fail )
timeout /t 2 /nobreak >nul
goto wait_docker
:docker_ready

echo  Subindo Postgres e Redis...
docker compose up -d postgres redis
if errorlevel 1 goto :fail

echo  Aguardando PostgreSQL (porta 55432)...
set /a pg_tries=%POSTGRES_WAIT_TRIES%
:wait_postgres
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "(Test-NetConnection -ComputerName localhost -Port 55432 -WarningAction SilentlyContinue).TcpTestSucceeded" 2>nul | findstr "True" >nul
if not errorlevel 1 goto postgres_ready
set /a pg_tries-=1
if !pg_tries! LEQ 0 ( echo  ERRO: PostgreSQL nao respondeu. & goto :fail )
timeout /t 2 /nobreak >nul
goto wait_postgres
:postgres_ready

echo  Prisma generate + migrate...
echo  Encerrando processos anteriores...
taskkill /F /IM node.exe >nul 2>nul
taskkill /F /IM ngrok.exe >nul 2>nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort 3101 -State Listen -EA SilentlyContinue | %% { Stop-Process -Id $_.OwningProcess -Force -EA SilentlyContinue }"
timeout /t 5 /nobreak >nul

echo  Prisma generate + migrate...
call %PNPM% --filter api db:generate
if errorlevel 1 goto :fail
set /a migrate_tries=%MIGRATE_RETRIES%
:migrate_retry
call %PNPM% db:migrate
if not errorlevel 1 goto migrate_ok
set /a migrate_tries-=1
if !migrate_tries! LEQ 0 goto :fail
timeout /t 5 /nobreak >nul
goto migrate_retry
:migrate_ok

echo  Compilando API e agente...
call %PNPM% --filter api build
if errorlevel 1 goto :fail
call %PNPM% --filter agent build
if errorlevel 1 goto :fail

echo  Iniciando API em background...
start "Rayzen API" powershell.exe -NoProfile -NoExit -ExecutionPolicy Bypass -Command "Set-Location -LiteralPath '%CD%'; $env:API_PORT='3101'; $env:REDIS_URL='redis://localhost:56379'; pnpm.cmd --filter api start"
timeout /t 5 /nobreak >nul

echo  Iniciando ngrok...
start "Rayzen Tunnel" powershell.exe -NoProfile -NoExit -ExecutionPolicy Bypass -Command "ngrok http 3101"

echo  Iniciando agente com auto-restart em background...
start "" /B powershell.exe -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File "%~dp0apps\agent\watchdog.ps1"

echo.
echo  API e ngrok: janelas visiveis
echo  Agente: background (log em apps\agent\agent.log)
echo  Copie a URL HTTPS do ngrok e atualize o hook.config.mjs e o Vercel.
echo.
exit /b 0

:fail
echo.
echo  ERRO: falha ao iniciar. Verifique os requisitos e tente novamente.
pause
exit /b 1
