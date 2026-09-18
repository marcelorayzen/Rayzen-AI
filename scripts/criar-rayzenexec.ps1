# Cria a conta local RayzenExec e o workspace dela.
#
# EXIGE ELEVACAO. Rode como Administrador, UMA vez:
#   1. clique com o botao direito no PowerShell -> "Executar como administrador"
#   2. cd C:\Users\marce\Desktop\Projects\rayzen-ai
#   3. powershell -ExecutionPolicy Bypass -File scripts\criar-rayzenexec.ps1
#
# Plano completo em docs/decisions/rayzenexec-preparacao.md.
#
# O que este script NAO faz, de proposito:
#   - nao copia ~/.claude, ~/.vscode, extensoes, .env, token nem credencial
#   - nao adiciona a conta a Administradores
#   - nao instala nada
#   - nao toca no seu perfil, no seu VS Code nem no Remote Control
#   - nao imprime a senha no terminal
#
# ASCII puro. Acento em .ps1 lido como ANSI vira aspa curva no PowerShell 5.1, que a trata
# como delimitador de string -- custou uma rodada em 06/09.

$ErrorActionPreference = 'Stop'

# ---- Guardas -----------------------------------------------------------------
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error 'Este script exige elevacao. Abra o PowerShell como Administrador e rode de novo.'
    exit 1
}

if (Get-LocalUser -Name 'RayzenExec' -ErrorAction SilentlyContinue) {
    Write-Output 'A conta RayzenExec ja existe. Nada a fazer -- o script nao altera conta existente.'
    exit 0
}

# ---- Conta -------------------------------------------------------------------
# Senha aleatoria de 32 caracteres. Nunca aparece no terminal nem em log.
$senha = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
$sec   = ConvertTo-SecureString $senha -AsPlainText -Force

# -Description tem limite de 48 CARACTERES no New-LocalUser, e a validacao e do parametro:
# falha antes de criar qualquer coisa. A versao anterior tinha 90 e apontava para o documento
# do plano -- o texto foi para o -FullName, que aceita ate 256.
New-LocalUser -Name 'RayzenExec' `
              -Password $sec `
              -FullName 'Rayzen Exec - sessoes do Claude Code CLI' `
              -Description 'Conta isolada. Ver docs/decisions/' `
              -PasswordNeverExpires `
              -UserMayNotChangePassword | Out-Null
Write-Output 'Conta RayzenExec criada.'

# `New-LocalUser` NAO adiciona a grupo nenhum -- eu tinha escrito aqui que `Usuarios` era o
# padrao, e estava errado: verificado em 09/09, a conta nasceu sem grupo algum. Sem `Usuarios`
# ela nao tem o direito de logon nem roda tarefa agendada de forma confiavel.
$grupoUsuarios = @('Usuarios', 'Users', 'Usu' + [char]0x00E1 + 'rios') |
                 Where-Object { Get-LocalGroup -Name $_ -ErrorAction SilentlyContinue } |
                 Select-Object -First 1
if (-not $grupoUsuarios) { Write-Error 'Grupo Usuarios/Users nao encontrado.'; exit 1 }
Add-LocalGroupMember -Group $grupoUsuarios -Member 'RayzenExec' -ErrorAction SilentlyContinue
Write-Output "Adicionada ao grupo $grupoUsuarios (minimo necessario)."

# NAO adicionar a Administradores -- e o requisito 2, e a unica linha deste script que
# importa mais que as outras. A conferencia abaixo existe porque afirmar nao e verificar.
$grupoAdmin = @('Administradores', 'Administrators') |
              Where-Object { Get-LocalGroup -Name $_ -ErrorAction SilentlyContinue } |
              Select-Object -First 1
$ehAdmin = (Get-LocalGroupMember -Group $grupoAdmin -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like '*\RayzenExec' }).Count
if ($ehAdmin -gt 0) {
    Write-Error 'RayzenExec acabou em Administradores. Isto nao deveria acontecer -- remova antes de seguir.'
    exit 1
}
Write-Output "Confirmado: RayzenExec NAO esta em $grupoAdmin."

# ---- Workspace ---------------------------------------------------------------
# Fora de C:\Users de proposito: o repositorio do dono vive dentro do perfil dele, que o
# Windows ja protege. A conta trabalha num CLONE proprio, e o trabalho volta por git.
foreach ($d in 'C:\RayzenExec', 'C:\RayzenExec\workspace', 'C:\RayzenExec\logs', 'C:\RayzenExec\tmp') {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

icacls 'C:\RayzenExec' /inheritance:r | Out-Null
icacls 'C:\RayzenExec' /grant:r 'RayzenExec:(OI)(CI)M' | Out-Null
icacls 'C:\RayzenExec' /grant:r "$($env:USERNAME):(OI)(CI)R" | Out-Null
icacls 'C:\RayzenExec' /grant:r 'SYSTEM:(OI)(CI)F' | Out-Null
Write-Output 'Workspace C:\RayzenExec criado, heranca removida.'

# ---- Senha -------------------------------------------------------------------
# Vai para um arquivo que so voce le. Necessaria para registrar a tarefa agendada que
# roda as sessoes sem interacao -- apague depois disso.
$arquivo = Join-Path $env:USERPROFILE 'rayzenexec-senha.txt'
Set-Content -Path $arquivo -Value $senha -Encoding utf8
icacls $arquivo /inheritance:r | Out-Null
icacls $arquivo /grant:r "$($env:USERNAME):(R,W)" | Out-Null

Write-Output ''
Write-Output "Senha gravada em: $arquivo (somente voce le)"
Write-Output 'Proximo passo: me avise. Eu sigo sem elevacao ate o login do Claude, que e seu.'
