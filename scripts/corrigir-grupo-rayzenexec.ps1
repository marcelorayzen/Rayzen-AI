# Corrige a conta RayzenExec que foi criada SEM grupo nenhum.
#
# EXIGE ELEVACAO. Rode como Administrador:
#   powershell -ExecutionPolicy Bypass -File scripts\corrigir-grupo-rayzenexec.ps1
#
# Motivo: `New-LocalUser` nao adiciona a grupo algum. O script de criacao afirmava que
# `Usuarios` era o padrao -- estava errado, e a verificacao pos-criacao pegou: a conta ficou
# em NENHUM grupo. Sem `Usuarios` ela nao tem direito de logon nem roda tarefa agendada de
# forma confiavel.
#
# Este script e idempotente e NAO toca em Administradores.

$ErrorActionPreference = 'Stop'

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error 'Este script exige elevacao. Abra o PowerShell como Administrador.'
    exit 1
}

$u = Get-LocalUser -Name 'RayzenExec' -ErrorAction SilentlyContinue
if (-not $u) { Write-Error 'Conta RayzenExec nao existe. Rode criar-rayzenexec.ps1 antes.'; exit 1 }

# O nome do grupo muda com o idioma do Windows. Descobrir pelo SID e o unico jeito que nao
# depende de localizacao: S-1-5-32-545 e sempre o grupo de usuarios.
$grupoUsuarios = (Get-LocalGroup | Where-Object { $_.SID.Value -eq 'S-1-5-32-545' }).Name
$grupoAdmin    = (Get-LocalGroup | Where-Object { $_.SID.Value -eq 'S-1-5-32-544' }).Name
if (-not $grupoUsuarios) { Write-Error 'Grupo de usuarios (S-1-5-32-545) nao encontrado.'; exit 1 }

$jaEsta = (Get-LocalGroupMember -Group $grupoUsuarios -ErrorAction SilentlyContinue |
           Where-Object { $_.SID.Value -eq $u.SID.Value }).Count
if ($jaEsta -gt 0) {
    Write-Output "Ja esta em $grupoUsuarios. Nada a fazer."
} else {
    Add-LocalGroupMember -Group $grupoUsuarios -Member 'RayzenExec'
    Write-Output "Adicionada a $grupoUsuarios."
}

# Conferir DEPOIS, nao antes: afirmar nao e verificar.
$admin = (Get-LocalGroupMember -Group $grupoAdmin -ErrorAction SilentlyContinue |
          Where-Object { $_.SID.Value -eq $u.SID.Value }).Count
if ($admin -gt 0) { Write-Error "RayzenExec esta em $grupoAdmin. Remova antes de seguir."; exit 1 }

Write-Output "Confirmado: em $grupoUsuarios, FORA de $grupoAdmin."
