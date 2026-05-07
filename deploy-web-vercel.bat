@echo off
setlocal EnableExtensions
chcp 65001 >nul

title Rayzen AI - Deploy Web to Vercel
cd /d "%~dp0"

set "MODE=preview"
if /i "%~1"=="--prod" set "MODE=prod"

where pnpm.cmd >nul 2>nul
if errorlevel 1 (
    echo ERRO: pnpm.cmd nao encontrado no PATH.
    exit /b 1
)

echo.
echo Deployando apps/web no Vercel usando o estado local atual...
echo Nenhum commit eh necessario.
echo.

pushd "apps\web"

if exist ".vercel\project.json" (
    echo Projeto Vercel vinculado:
    type ".vercel\project.json"
    echo.
) else (
    echo AVISO: apps/web ainda nao esta vinculado a um projeto Vercel.
    echo Rode o link antes do deploy se necessario.
    echo.
)

if /i "%MODE%"=="prod" (
    call pnpm.cmd dlx vercel deploy --prod
) else (
    call pnpm.cmd dlx vercel deploy
)

set "EXITCODE=%errorlevel%"
popd
exit /b %EXITCODE%
