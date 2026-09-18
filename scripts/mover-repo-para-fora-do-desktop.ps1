# Move o repositorio de C:\Users\marce\Desktop\Projects\rayzen-ai
#                   para C:\Users\marce\Projects\rayzen-ai
#
# NAO exige elevacao. Mas exige que NADA esteja segurando o diretorio:
#   - feche o VS Code
#   - feche esta sessao do Claude Code
#   - o script para o agent e o widget sozinho
#
# COMO RODAR (de fora do repositorio, senao o proprio script trava a pasta):
#   copy scripts\mover-repo-para-fora-do-desktop.ps1 C:\Users\Public\rayzen-drop\
#   cd C:\
#   powershell -ExecutionPolicy Bypass -File C:\Users\Public\rayzen-drop\mover-repo-para-fora-do-desktop.ps1
#
# POR QUE
# C:\Users\marce\Desktop tem um ACE EXPLICITO `BUILTIN\Usuarios:(OI)(CI)(M)`, herdado por tudo
# abaixo: qualquer conta local desta maquina LE E ESCREVE no Desktop inteiro -- inclusive o
# .env do repositorio, com todos os segredos. Medido em 09/09: a conta RayzenExec leu o .env.
#
# A raiz do perfil NAO tem esse ACE. Medido criando pastas de teste e lendo de dentro da conta:
#   C:\Users\marce\<qualquer>  -> NEGADO   para RayzenExec
#   C:\<qualquer>              -> LIDO     (a raiz de C: concede Usuarios:(RX) por heranca)
#
# Por isso o destino e dentro do perfil, e NAO C:\Projects.
#
# `SAFE_ROOTS` do path-guard ja inclui HOME/Projects -- nenhuma mudanca de codigo e necessaria.

param(
    # Registra uma tarefa que faz a mudanca no PROXIMO logon, antes de o VS Code abrir, e
    # depois se remove. Serve para quando fechar tudo agora nao e conveniente.
    [switch]$AgendarNoLogon
)

$ErrorActionPreference = 'Stop'

$origem  = Join-Path $env:USERPROFILE 'Desktop\Projects\rayzen-ai'
$destino = Join-Path $env:USERPROFILE 'Projects\rayzen-ai'

# ---- Guardas -----------------------------------------------------------------
if ($PSScriptRoot -like "$origem*") {
    Write-Error "Este script esta DENTRO do repositorio ($PSScriptRoot) e travaria a pasta. Copie para C:\Users\Public\rayzen-drop e rode de la."
    exit 1
}
if ((Get-Location).Path -like "$origem*") {
    Write-Error "O diretorio atual esta dentro do repositorio. Faca 'cd C:\' antes."
    exit 1
}
if (-not (Test-Path $origem))  { Write-Error "Origem nao existe: $origem"; exit 1 }
if (Test-Path $destino)        { Write-Error "Destino JA existe: $destino. Resolva antes."; exit 1 }

# ---- Modo agendado -------------------------------------------------------------
if ($AgendarNoLogon) {
    $este = $MyInvocation.MyCommand.Path
    $log  = Join-Path $env:TEMP 'rayzen-mover-repo.log'
    $acao = New-ScheduledTaskAction -Execute 'powershell.exe' `
              -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$este`" *> `"$log`"" `
              -WorkingDirectory 'C:'
    $gatilho = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    # 20s: cedo o bastante para ganhar do VS Code, tarde o bastante para o perfil estar pronto.
    $gatilho.Delay = 'PT20S'
    Register-ScheduledTask -TaskName 'Rayzen - Mover repo' -Action $acao -Trigger $gatilho `
                           -Description 'Move o repo do Desktop para o perfil. Auto-remove.' -Force | Out-Null
    Write-Output 'Tarefa "Rayzen - Mover repo" registrada para o proximo logon.'
    Write-Output "Log em: $log"
    Write-Output 'Faca logoff/logon (ou reinicie) SEM abrir o VS Code antes.'
    exit 0
}

# ---- Parar o que segura a pasta ----------------------------------------------
# Mata o que DA para identificar por linha de comando: agent, widget, esbuild.
$presos = Get-CimInstance Win32_Process |
          Where-Object { $_.CommandLine -like "*$origem*" -or $_.ExecutablePath -like "*$origem*" }
foreach ($p in $presos) {
    try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; Write-Output "parado: $($p.Name) ($($p.ProcessId))" } catch {}
}
Start-Sleep -Seconds 4

# ---- SONDA REAL de handle ------------------------------------------------------
# A verificacao anterior por CommandLine era insuficiente, e a falha de 09/09 mostrou por que:
# VS Code, terminais e a sessao do Claude Code seguram a pasta pelo CWD ou por handle aberto,
# e `Win32_Process` NAO expoe nenhum dos dois -- o caminho do repo nao aparece em campo algum.
# O guard dizia "nenhum processo segurando" e o `Move-Item` falhava na linha seguinte.
#
# A sonda certa e tentar renomear NO LUGAR: e a mesma operacao que o move faz, e ou funciona
# ou nao. Medir o que se vai fazer, em vez de inferir de um proxy.
$sonda = "$origem-sonda-handle"
try {
    Rename-Item -LiteralPath $origem -NewName (Split-Path $sonda -Leaf) -ErrorAction Stop
    Rename-Item -LiteralPath $sonda  -NewName (Split-Path $origem -Leaf) -ErrorAction Stop
    Write-Output 'Sonda: a pasta esta livre.'
} catch {
    Write-Output ''
    Write-Output 'A pasta AINDA esta presa. Quem costuma segurar, por nome:'
    Get-Process -Name Code,node,bash,git,powershell,pwsh,esbuild,electron -ErrorAction SilentlyContinue |
        Group-Object ProcessName |
        ForEach-Object { "   {0,-12} {1} processo(s)" -f $_.Name, $_.Count } |
        Write-Output
    Write-Output ''
    Write-Output 'Feche TUDO isto antes de rodar de novo:'
    Write-Output '  - o VS Code inteiro (a janela fechada nao basta: confira que nao ha Code.exe)'
    Write-Output '  - a sessao do Claude Code (ela roda dentro do VS Code)'
    Write-Output '  - qualquer terminal cujo diretorio atual seja o repositorio'
    Write-Output ''
    Write-Output 'Depois abra um PowerShell pelo menu Iniciar (NAO pelo terminal do VS Code),'
    Write-Output 'faca `cd C:\` e rode este script de novo.'
    Write-Output ''
    Write-Output 'Alternativa sem fechar nada agora: rode com -AgendarNoLogon e reinicie.'
    exit 1
}

# ---- Mover -------------------------------------------------------------------
# Mesmo volume: e uma renomeacao, instantanea. Nao copia nem duplica.
Write-Output "movendo $origem -> $destino"
Move-Item -LiteralPath $origem -Destination $destino
Write-Output 'movido.'

# ---- Verificar que o destino NAO e legivel por outras contas ------------------
$acl = icacls $destino
if ($acl -match 'Usu.rios:' -or $acl -match 'BUILTIN\\Users:') {
    Write-Warning 'ATENCAO: o destino concede acesso a Usuarios. O objetivo da mudanca NAO foi atingido.'
    $acl | Write-Output
} else {
    Write-Output 'Confirmado: o destino nao concede acesso ao grupo Usuarios.'
}

# ---- Atualizar a tarefa de autostart -----------------------------------------
$t = Get-ScheduledTask -TaskName 'Rayzen AI - Autostart' -ErrorAction SilentlyContinue
if ($t) {
    $log  = Join-Path $env:TEMP 'rayzen-autostart.log'
    $bat  = Join-Path $destino 'rayzen-start.bat'
    $acao = New-ScheduledTaskAction -Execute 'cmd.exe' `
              -Argument "/c `"set RAYZEN_AUTOSTART=1 && `"$bat`" > `"$log`" 2>&1`"" `
              -WorkingDirectory $destino
    Set-ScheduledTask -TaskName 'Rayzen AI - Autostart' -Action $acao | Out-Null
    Write-Output 'Tarefa de autostart atualizada para o novo caminho.'
} else {
    Write-Output 'Tarefa de autostart nao encontrada -- nada a atualizar.'
}

# Se veio da tarefa agendada, ela se remove: existe para uma vez so.
if (Get-ScheduledTask -TaskName 'Rayzen - Mover repo' -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName 'Rayzen - Mover repo' -Confirm:$false -ErrorAction SilentlyContinue
    Write-Output 'Tarefa "Rayzen - Mover repo" removida -- ela existia para uma vez so.'
}

Write-Output ''
Write-Output "PRONTO. Novo caminho: $destino"
Write-Output 'Proximos passos, na ordem:'
Write-Output '  1. abra o VS Code no NOVO caminho'
Write-Output '  2. inicie uma sessao nova do Claude Code de la'
Write-Output '  3. rode: pnpm --filter agent build   (o dist tem caminhos absolutos em cache)'
Write-Output '  4. suba o agent com rayzen-start.bat'
Write-Output '  5. confirme com a conta RayzenExec que o .env agora e NEGADO'
