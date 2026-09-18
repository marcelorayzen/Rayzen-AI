# Registra (ou remove) a tarefa que sobe o Rayzen no logon.
#
# Motivo: ate 2026-09-06 nao havia autostart nenhum -- pasta Startup vazia, nenhuma
# tarefa agendada. O PC reiniciou em 05/09, ninguem religou o agent, e ele ficou 28h
# fora sem que nada acusasse: os hooks do Claude Code rodam do `src` e continuam
# funcionando, o painel fica verde, e o contexto injetado sai com a mesma cara.
#
# O aviso no contexto injetado (ver docs/HOOKS.md) e o sensor; isto e o conserto.
# Os dois ficam: tarefa agendada tambem falha, e ai o aviso volta a ser a unica coisa
# que fala.
#
#   pnpm autostart:install     # registra
#   pnpm autostart:status      # mostra o estado
#   pnpm autostart:uninstall   # remove
#
# Nao exige elevacao: a tarefa e do usuario atual, com trigger de logon do usuario atual.

param(
    [ValidateSet('install', 'uninstall', 'status')]
    [string]$Action = 'install',

    # Espera depois do logon antes de subir. O agent fala com a API pela internet e o
    # widget com o Electron; subir no primeiro segundo do logon pega a rede ainda
    # subindo e transforma "autostart" em "autostart que falha calado".
    [int]$DelaySeconds = 90
)

$ErrorActionPreference = 'Stop'
$TaskName = 'Rayzen AI - Autostart'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Bat      = Join-Path $RepoRoot 'rayzen-start.bat'

function Show-Status {
    $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $t) { Write-Output "  nao registrada"; return }
    $info = Get-ScheduledTaskInfo -TaskName $TaskName
    Write-Output "  estado:        $($t.State)"
    Write-Output "  ultima exec:   $($info.LastRunTime)  (resultado $($info.LastTaskResult))"
    Write-Output "  proxima exec:  $($info.NextRunTime)"
    Write-Output "  acao:          $($t.Actions[0].Execute) $($t.Actions[0].Arguments)"
}

switch ($Action) {
    'status' {
        Write-Output "Tarefa '$TaskName':"
        Show-Status
    }

    'uninstall' {
        if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
            Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
            Write-Output "Removida: $TaskName"
        } else {
            Write-Output "Nada a remover -- '$TaskName' nao existe."
        }
    }

    'install' {
        if (-not (Test-Path $Bat)) { throw "rayzen-start.bat nao encontrado em $Bat" }

        # cmd.exe /c, nao o .bat direto: o Agendador nao herda o `cd` do script e o
        # `%~dp0` do bat depende de ser executado como um comando, nao como imagem solta.
        #
        # RAYZEN_AUTOSTART=1 desliga `pause` e `timeout` no bat. Sem isso ele TRAVA:
        # o Agendador nao da console, `pause` espera uma tecla que nunca vem, e o
        # sintoma e um cmd.exe vivo por minutos sem subir nada e sem dizer por que
        # (medido em 06/09, na primeira tentativa de registrar esta tarefa).
        #
        # O LOG NAO E MAIS REDIRECIONADO AQUI -- quem escreve e o proprio .bat.
        #
        # Ate 09/09 esta linha tinha `> "$log" 2>&1`, redirecionando o `cmd` inteiro. Os
        # `start` do bat criam janelas `powershell -NoExit`, que HERDAM esse handle e ficam
        # vivas mesmo quando o comando dentro delas falha. O log ficava com handle exclusivo
        # por tempo indeterminado, e a execucao SEGUINTE nao conseguia abri-lo: o `cmd`
        # devolvia 1 sem executar uma linha do script.
        #
        # Medido em 09/09: a execucao das 02:07 deixou 4 janelas vivas; a das 07:37 devolveu
        # LastTaskResult 1 com o log ainda datado de 02:07 -- intocado. O autostart passava a
        # se auto-bloquear depois da primeira vez, com a mesma cara de "falhou ao subir".
        #
        # O bat agora redireciona so a fase de preparo, que termina antes dos `start`.
        $cmd = "set RAYZEN_AUTOSTART=1 && `"$Bat`""
        # `$acao`, nao `$action`: variavel do PowerShell nao diferencia maiusculas, e o
        # param `$Action` acima tem [ValidateSet] -- atribuir um MSFT_TaskExecAction a ele
        # falha a validacao. O erro fala do ValidateSet e nao da colisao, o que faz
        # procurar defeito no lugar errado.
        $acao = New-ScheduledTaskAction -Execute 'cmd.exe' `
                                        -Argument "/c `"$cmd`"" `
                                        -WorkingDirectory $RepoRoot

        $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
        $trigger.Delay = "PT${DelaySeconds}S"

        # ExecutionTimeLimit 0 = sem teto: o agent e um processo de longa duracao e o
        # padrao de 3 dias mataria a tarefa em uso continuo.
        # MultipleInstances IgnoreNew: logon repetido nao sobe um segundo agent.
        # RunOnlyIfNetworkAvailable e DE PROPOSITO falso -- o `false` evita que a tarefa
        # seja simplesmente PULADA quando o Windows ainda nao classificou a rede; o
        # atraso acima e quem resolve o problema de rede, e ele nao desiste calado.
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
                                                 -DontStopIfGoingOnBatteries `
                                                 -MultipleInstances IgnoreNew `
                                                 -ExecutionTimeLimit ([TimeSpan]::Zero) `
                                                 -StartWhenAvailable

        Register-ScheduledTask -TaskName $TaskName `
                               -Action $acao `
                               -Trigger $trigger `
                               -Settings $settings `
                               -Description 'Sobe o agent desktop e o widget do Rayzen AI no logon. Ver scripts/install-autostart.ps1.' `
                               -Force | Out-Null

        Write-Output "Registrada: $TaskName (atraso de ${DelaySeconds}s apos o logon)"
        Show-Status
        Write-Output ""
        Write-Output "Para conferir sem reiniciar:  Start-ScheduledTask -TaskName '$TaskName'"
    }
}
