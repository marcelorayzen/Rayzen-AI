@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title Rayzen AI - Iniciando...
cd /d "%~dp0"

echo.
echo  Rayzen AI - Iniciando Agent + Widget
echo.

where pnpm.cmd >nul 2>nul
if errorlevel 1 (
    echo  ERRO: pnpm nao encontrado.
    pause & exit /b 1
)

rem ── Verifica .env ──────────────────────────────────────────────────────────
set "ENV_FILE=.env"
if not exist "%ENV_FILE%" (
    echo  ERRO: .env nao encontrado na raiz do projeto.
    pause & exit /b 1
)

rem ── Instala dependencias se necessario ─────────────────────────────────────
if not exist "node_modules" (
    echo  Instalando dependencias...
    call pnpm.cmd install --frozen-lockfile
)

if not exist "apps\widget\node_modules" (
    echo  Instalando dependencias do widget...
    call pnpm.cmd --filter widget install
)

rem ── Compila agent se necessario ────────────────────────────────────────────
if not exist "apps\agent\dist\index.js" (
    echo  Compilando agent...
    call pnpm.cmd --filter agent build
)

echo.
echo  [1/2] Subindo Agent em background...
start "Rayzen Agent" /MIN powershell.exe -NoProfile -NoExit -ExecutionPolicy Bypass -Command ^
  "Set-Location -LiteralPath '%CD%'; $env:DOTENV_CONFIG_PATH='.env'; pnpm.cmd --filter agent start"

timeout /t 2 /nobreak >nul

echo  [2/2] Abrindo Widget...
start "Rayzen Widget" powershell.exe -NoProfile -NoExit -ExecutionPolicy Bypass -Command ^
  "Set-Location -LiteralPath '%CD%'; pnpm.cmd --filter widget dev"

echo.
echo  Rayzen iniciado.
echo  Agent: janela minimizada na barra de tarefas
echo  Widget: abrindo em instantes...
echo.
timeout /t 3 /nobreak >nul
exit /b 0
