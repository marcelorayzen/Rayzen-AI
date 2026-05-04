@echo off
setlocal
chcp 65001 >nul

title Rayzen AI - Dev Start
cd /d "%~dp0"

set "OPEN_VSCODE=0"
set "PNPM=pnpm.cmd"

echo.
echo  Rayzen AI - subindo ambiente local...
echo  (dados do banco preservados nos volumes Docker)
echo.

where %PNPM% >nul 2>nul
if errorlevel 1 (
    echo  ERRO: pnpm nao encontrado no PATH.
    echo  Instale/habilite o pnpm e abra este script novamente:
    echo    corepack enable
    echo    corepack prepare pnpm@10.33.2 --activate
    pause
    exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node" 2^>nul') do set NODE_MAJOR=%%v
if "%NODE_MAJOR%"=="" (
    echo  ERRO: Node.js nao encontrado no PATH.
    echo  Instale Node.js 20 LTS e abra este script novamente.
    pause
    exit /b 1
)
if not "%NODE_MAJOR%"=="20" (
    echo  ERRO: Node.js %NODE_MAJOR% detectado, mas este projeto espera Node.js 20 LTS.
    echo  Instale/use Node.js 20 LTS antes de subir o Rayzen.
    echo  Versao atual:
    node --version
    pause
    exit /b 1
)

where docker >nul 2>nul
if errorlevel 1 (
    echo  ERRO: Docker nao encontrado no PATH.
    echo  Verifique se o Docker Desktop esta instalado.
    pause
    exit /b 1
)

if not exist ".env" (
    echo  ERRO: arquivo .env nao encontrado na raiz do projeto.
    echo  Crie/copiei o .env antes de subir o Rayzen.
    pause
    exit /b 1
)

if not exist "apps\api\.env" (
    echo  Copiando .env para apps\api\.env...
    copy ".env" "apps\api\.env" >nul
)

if "%OPEN_VSCODE%"=="1" (
    echo  Abrindo VS Code...
    if exist "%LocalAppData%\Programs\Microsoft VS Code\Code.exe" (
        start "Rayzen AI - VS Code" "%LocalAppData%\Programs\Microsoft VS Code\Code.exe" "%CD%"
    ) else (
        where code >nul 2>nul
        if not errorlevel 1 (
            start "Rayzen AI - VS Code" code "%CD%"
        ) else (
            echo  AVISO: VS Code nao encontrado no PATH.
        )
    )
)

if not exist "node_modules" (
    echo  Instalando dependencias...
    call %PNPM% install --frozen-lockfile
    if errorlevel 1 (
        echo.
        echo  ERRO: falha ao instalar dependencias.
        pause
        exit /b 1
    )
)

echo  Subindo Postgres, Redis e LiteLLM...
docker compose up -d postgres redis litellm
if errorlevel 1 (
    echo.
    echo  ERRO: Docker nao respondeu. Verifique se o Docker Desktop esta aberto.
    pause
    exit /b 1
)

echo.
echo  Aguardando PostgreSQL...
ping 127.0.0.1 -n 9 >nul

echo  Liberando portas antigas da API e Web...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ports = 3000, 3001, 3100, 3101; foreach ($port in $ports) { Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }"
ping 127.0.0.1 -n 2 >nul

echo  Gerando Prisma Client...
call %PNPM% --filter api db:generate
if errorlevel 1 (
    echo.
    echo  ERRO: falha ao gerar Prisma Client.
    pause
    exit /b 1
)

echo  Aplicando migrations do banco...
call %PNPM% db:migrate
if errorlevel 1 (
    echo.
    echo  ERRO: falha ao aplicar migrations.
    echo  Confira DATABASE_URL no .env e se o Postgres terminou de iniciar.
    pause
    exit /b 1
)

echo.
echo  Abrindo API, Web e Agent em PowerShell liberado...
echo  Bypass aplicado nas janelas abaixo com: -ExecutionPolicy Bypass

start "Rayzen API" powershell.exe -NoProfile -NoExit -ExecutionPolicy Bypass -Command "Set-Location -LiteralPath '%CD%'; $env:API_PORT='3101'; $env:LITELLM_BASE_URL='http://localhost:4100/v1'; $env:REDIS_URL='redis://localhost:56379'; pnpm.cmd dev:api"
ping 127.0.0.1 -n 3 >nul

start "Rayzen Web" powershell.exe -NoProfile -NoExit -ExecutionPolicy Bypass -Command "Set-Location -LiteralPath '%CD%'; $env:NEXT_PUBLIC_API_URL='http://localhost:3101'; pnpm.cmd --filter web exec next dev -p 3100"
ping 127.0.0.1 -n 3 >nul

start "Rayzen Agent" powershell.exe -NoProfile -NoExit -ExecutionPolicy Bypass -Command "Set-Location -LiteralPath '%CD%'; $env:AGENT_API_URL='http://localhost:3101'; pnpm.cmd dev:agent"

echo.
echo  Terminais abertos.
echo.
echo  API   : http://localhost:3101
echo  Web   : http://localhost:3100
echo  Docs  : http://localhost:3101/docs
echo.
echo  Para parar tudo: feche os terminais e rode docker compose stop
echo.
pause
