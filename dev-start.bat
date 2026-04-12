@echo off
title Rayzen AI — Dev Start
cd /d "%~dp0"

echo.
echo  Rayzen AI — Subindo ambiente...
echo  (dados do banco preservados nos volumes Docker)
echo.

REM Copia .env para apps/api se nao existir
if not exist "apps\api\.env" (
    echo  Copiando .env para apps\api\.env...
    copy ".env" "apps\api\.env" >nul
)

REM Sobe infra sem recriar volumes — dados preservados
docker compose up -d postgres redis litellm
if %errorlevel% neq 0 (
    echo.
    echo  ERRO: Docker nao respondeu. Verifique se o Docker Desktop esta aberto.
    pause
    exit /b 1
)

echo.
echo  Aguardando PostgreSQL...
timeout /t 5 /nobreak >nul

REM Abre tres terminais, um para cada processo
start "Rayzen — API" cmd /k "cd /d "%~dp0" && pnpm dev:api"
timeout /t 2 /nobreak >nul
start "Rayzen — Web" cmd /k "cd /d "%~dp0" && pnpm dev:web"
timeout /t 2 /nobreak >nul
start "Rayzen — Agent" cmd /k "cd /d "%~dp0" && pnpm dev:agent"

echo.
echo  Tres terminais abertos.
echo.
echo  API   → http://localhost:3001
echo  Web   → http://localhost:3000
echo  Docs  → http://localhost:3001/docs
echo.
echo  Para parar tudo: feche os terminais e rode docker compose stop
echo.
pause
