@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul

title Rayzen AI - Widget
cd /d "%~dp0"

echo.
echo  Rayzen AI - Widget
echo.

where pnpm.cmd >nul 2>nul
if errorlevel 1 (
    echo  ERRO: pnpm nao encontrado no PATH.
    pause
    exit /b 1
)

if not exist "apps\widget\node_modules" (
    echo  Instalando dependencias do widget...
    call pnpm.cmd --filter widget install
    if errorlevel 1 (
        echo  ERRO: falha ao instalar dependencias.
        pause
        exit /b 1
    )
)

echo  Iniciando widget...
echo.

start "Rayzen Widget" powershell.exe -NoProfile -NoExit -ExecutionPolicy Bypass -Command ^
  "Set-Location -LiteralPath '%CD%'; pnpm.cmd --filter widget dev"

exit /b 0
