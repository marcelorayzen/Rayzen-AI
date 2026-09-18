@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title Rayzen AI - Iniciando...
cd /d "%~dp0"

set "LOG=%TEMP%\rayzen-autostart.log"

echo.
echo  Rayzen AI - Iniciando Agent + Widget
echo.

rem -- Modo automatico --------------------------------------------------------
rem
rem Este script foi escrito para duplo-clique: `pause` para o erro nao sumir da
rem tela, `timeout` para escalonar as duas janelas. Sob o Agendador de Tarefas
rem nao ha console: `pause` fica esperando uma tecla que nunca vem e o processo
rem TRAVA para sempre -- medido em 06/09, o `cmd.exe` do autostart ficou vivo
rem minutos sem subir nada e sem dizer por que.
rem
rem O modo e explicito (`RAYZEN_AUTOSTART=1`, setado por scripts/install-autostart.ps1)
rem e nao adivinhado: detectar console por heuristica erraria de um jeito que
rem devolve exatamente este travamento, mas so as vezes.
set "PAUSA=pause"
set "ESPERA=timeout /t"
if defined RAYZEN_AUTOSTART (
    set "PAUSA=rem sem pausa - modo automatico"
    set "ESPERA=rem sem espera - modo automatico"
)

rem -- FASE 1: preparar (redirecionada) ---------------------------------------
rem
rem POR QUE O LOG E ESCRITO AQUI, E NAO PELA TAREFA AGENDADA
rem
rem Ate 09/09 a tarefa redirecionava o `cmd` INTEIRO para o log. Os `start` da fase 2
rem criam janelas `powershell -NoExit`, que HERDAM o handle desse log -- e o `-NoExit`
rem as mantem vivas mesmo quando o comando dentro delas falha. Resultado: o arquivo
rem fica com handle exclusivo por tempo indeterminado, e a execucao SEGUINTE do
rem autostart nao consegue abrir o log para escrita. O `cmd` entao devolve 1 sem
rem executar UMA LINHA do script.
rem
rem Medido em 09/09: a execucao das 02:07 deixou 4 janelas vivas; a das 07:37 saiu com
rem LastTaskResult 1 e o log seguia com data de 02:07 -- intocado. O autostart passava a
rem se auto-bloquear depois da primeira vez, com a mesma cara de "falhou ao subir".
rem
rem Por isso o redirecionamento cobre SO a fase de preparo, e termina antes dos `start`.
rem A fase 2 nunca e redirecionada: nada que ela cria pode herdar um handle de arquivo.
if defined RAYZEN_AUTOSTART (
    call :preparar > "%LOG%" 2>&1
) else (
    call :preparar
)
if errorlevel 1 (
    echo.
    echo  ERRO ao preparar -- NAO subindo. Detalhes em: %LOG%
    %PAUSA%
    exit /b 1
)

rem -- FASE 2: subir (NUNCA redirecionada) ------------------------------------
echo.
echo  [1/2] Subindo Agent em background...
start "Rayzen Agent" /MIN powershell.exe -NoProfile -NoExit -ExecutionPolicy Bypass -Command ^
  "Set-Location -LiteralPath '%CD%'; $env:DOTENV_CONFIG_PATH='.env'; pnpm.cmd --filter agent start"

%ESPERA% 2 /nobreak >nul

echo  [2/2] Abrindo Widget...
start "Rayzen Widget" powershell.exe -NoProfile -NoExit -ExecutionPolicy Bypass -Command ^
  "Set-Location -LiteralPath '%CD%'; pnpm.cmd --filter widget dev"

echo.
echo  Rayzen iniciado.
echo  Agent: janela minimizada na barra de tarefas
echo  Widget: abrindo em instantes...
echo.
%ESPERA% 3 /nobreak >nul
exit /b 0

rem ===========================================================================
:preparar
rem
rem Por que `%PAUSA%` e `exit` ficam em LINHAS SEPARADAS
rem
rem Era `%PAUSA% & exit /b 1`. Em modo automatico PAUSA vale `rem sem pausa ...`, e
rem `rem` comenta a linha INTEIRA -- inclusive o `& exit /b 1` depois dele. Resultado:
rem sob o Agendador, NENHUMA das saidas de erro deste script saia de nada.
rem
rem Medido em 09/09 02:07: `tsc` falhou (node_modules quebrado pelo move do repo), o
rem script imprimiu "NAO subindo com o dist antigo", subiu assim mesmo com o dist de
rem 08/09, e a tarefa devolveu LastTaskResult 0. Exatamente o cenario que aquela
rem mensagem existe para impedir -- no modo em que ninguem le a tela.
where pnpm.cmd >nul 2>nul
if errorlevel 1 (
    echo  ERRO: pnpm nao encontrado.
    exit /b 1
)

rem -- Verifica .env ----------------------------------------------------------
set "ENV_FILE=.env"
if not exist "%ENV_FILE%" (
    echo  ERRO: .env nao encontrado na raiz do projeto.
    exit /b 1
)

rem -- Instala dependencias se necessario -------------------------------------
if not exist "node_modules" (
    echo  Instalando dependencias...
    call pnpm.cmd install --frozen-lockfile
)

if not exist "apps\widget\node_modules" (
    echo  Instalando dependencias do widget...
    call pnpm.cmd --filter widget install
)

rem -- Compila o agent SEMPRE -------------------------------------------------
rem
rem Ate 2026-09-06 a condicao era `if not exist dist\index.js`, ou seja: compila
rem uma vez na vida e nunca mais. Medido nesse dia -- todo o `dist\` estava
rem congelado em 17/08 07:59, e o agent rodava havia 20 dias com codigo daquela
rem data. O endurecimento do `supervised_session` (worktree isolado, lista de
rem negacao, sem bypass cego) estava commitado, testado e FORA do ar.
rem
rem O `agent-start.bat` sempre compilou. Era o `rayzen-start.bat` -- justamente o
rem que a documentacao manda preferir para nao pegar o gerador antigo -- que
rem garantia o oposto.
rem
rem `tsc` incremental custa ~5s. Nao ha economia que pague rodar codigo de outra
rem semana sem saber.
echo  Compilando agent...
call pnpm.cmd --filter agent build
if errorlevel 1 (
    echo.
    echo  ERRO: falha ao compilar o agent -- NAO subindo com o dist antigo.
    echo  Subir assim rodaria codigo de data desconhecida parecendo saudavel.
    exit /b 1
)

exit /b 0
