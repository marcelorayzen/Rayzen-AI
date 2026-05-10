@echo off
setlocal EnableExtensions EnableDelayedExpansion

title Rayzen AI - Notebook API + Tunnel
cd /d "%~dp0"

set "AUTO_MODE=1"
if /i "%~1"=="--interactive" set "AUTO_MODE=0"

set "PNPM=pnpm.cmd"
set "DOCKER_WAIT_TRIES=90"
set "POSTGRES_WAIT_TRIES=90"
set "MIGRATE_RETRIES=5"

echo.
echo  Rayzen AI - subindo notebook (Postgres + Redis + API + ngrok)...
echo.

where %PNPM% >nul 2>nul
if errorlevel 1 goto :fail
where docker >nul 2>nul
if errorlevel 1 goto :fail
where ngrok >nul 2>nul
if errorlevel 1 goto :fail

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node" 2^>nul') do set NODE_MAJOR=%%v
if not "%NODE_MAJOR%"=="20" if not "%NODE_MAJOR%"=="22" goto :fail

if not exist ".env" goto :fail
copy /y ".env" "apps\api\.env" >nul

if not exist "node_modules" (
    call %PNPM% install --frozen-lockfile
    if errorlevel 1 goto :fail
)

echo  Aguardando Docker Engine responder...
set /a docker_tries=%DOCKER_WAIT_TRIES%
:wait_docker
docker version >nul 2>nul
if not errorlevel 1 goto docker_ready
set /a docker_tries-=1
if !docker_tries! LEQ 0 goto :fail
timeout /t 2 /nobreak >nul
goto wait_docker
:docker_ready

echo  Subindo Postgres, Redis e LiteLLM...
docker compose up -d postgres redis litellm
if errorlevel 1 goto :fail

echo  Aguardando PostgreSQL na porta 55432...
set /a pg_tries=%POSTGRES_WAIT_TRIES%
:wait_postgres
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ok = (Test-NetConnection -ComputerName 'localhost' -Port 55432 -WarningAction SilentlyContinue).TcpTestSucceeded; if ($ok) { exit 0 } else { exit 1 }" >nul 2>nul
if not errorlevel 1 goto postgres_ready
set /a pg_tries-=1
if !pg_tries! LEQ 0 goto :fail
timeout /t 2 /nobreak >nul
goto wait_postgres
:postgres_ready

echo  Aguardando LiteLLM na porta 4100...
set /a llm_tries=60
:wait_litellm
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ok = (Test-NetConnection -ComputerName 'localhost' -Port 4100 -WarningAction SilentlyContinue).TcpTestSucceeded; if ($ok) { exit 0 } else { exit 1 }" >nul 2>nul
if not errorlevel 1 goto litellm_ready
set /a llm_tries-=1
if !llm_tries! LEQ 0 ( echo  AVISO: LiteLLM demorou — continuando. & goto litellm_ready )
timeout /t 2 /nobreak >nul
goto wait_litellm
:litellm_ready

echo  Gerando Prisma Client...
call %PNPM% --filter api db:generate
if errorlevel 1 goto :fail

echo  Aplicando migrations...
set /a migrate_tries=%MIGRATE_RETRIES%
:migrate_retry
call %PNPM% db:migrate
if not errorlevel 1 goto migrate_ok
set /a migrate_tries-=1
if !migrate_tries! LEQ 0 goto :fail
timeout /t 5 /nobreak >nul
goto migrate_retry
:migrate_ok

echo  Liberando porta antiga da API...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ports = 3101; foreach ($port in $ports) { Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }"
timeout /t 2 /nobreak >nul

call %PNPM% --filter api build
if errorlevel 1 goto :fail

echo.
echo  Abrindo API e ngrok...
start "Rayzen API" powershell.exe -NoProfile -NoExit -ExecutionPolicy Bypass -Command "Set-Location -LiteralPath '%CD%'; $env:API_PORT='3101'; $env:REDIS_URL='redis://localhost:56379'; pnpm.cmd --filter api start"
timeout /t 5 /nobreak >nul
start "Rayzen API Tunnel" powershell.exe -NoProfile -NoExit -ExecutionPolicy Bypass -Command "ngrok http 3101"

echo.
echo  API local: http://localhost:3101
echo  Abra a janela do ngrok e use a URL HTTPS dela:
echo  - no Web do Vercel, campo URL da API
echo  - no AGENT_API_URL do outro PC
echo.
if "%AUTO_MODE%"=="0" pause
exit /b 0

:fail
echo  ERRO: falha ao subir notebook API+tunel.
if "%AUTO_MODE%"=="0" pause
exit /b 1
