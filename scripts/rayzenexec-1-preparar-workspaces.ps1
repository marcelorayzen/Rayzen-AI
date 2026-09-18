# Executar como Administrador, UMA vez.
#
# Cria C:\RayzenExec\workspaces com ACL EXPLICITA, sem heranca, e SEM os principais
# que hoje vazam o repositorio: BUILTIN\Usuarios e CodexSandboxUsers.
#
# POR QUE ELEVADO
# C:\RayzenExec tem `marce:(OI)(CI)(R)` e owner BUILTIN\Administradores. Medido em 09/09:
#   criar C:\RayzenExec\workspaces   -> NEGADO
#   escrever em ...\workspace        -> NEGADO
#   Set-Acl em C:\RayzenExec         -> NEGADO (falta SeSecurityPrivilege)
# Nao ha caminho sem elevacao, e dar escrita a `marce` ali enfraqueceria a separacao que
# a conta existe para ter. Um script elevado, uma vez, e o preco correto.
#
# O QUE ESTE SCRIPT NAO FAZ
#   - nao adiciona RayzenExec a Administradores
#   - nao toca no perfil de marce, VS Code, extensoes ou Remote Control
#   - nao move, copia ou apaga nada do repositorio existente
#   - nao concede "Log on as a batch job" (Start-Process -Credential ja resolve, e foi validado)
#
# O QUE ELE PRECISA CORRIGIR NA RAIZ, E POR QUE
# `criar-rayzenexec.ps1` rodou `/inheritance:r` em C:\RayzenExec e concedeu SOMENTE
# SYSTEM(F), marce(R) e RayzenExec(M). BUILTIN\Administradores ficou de fora da DACL, entao
# NEM ELEVADO se cria diretorio ali: o token carrega o grupo, mas a DACL nao concede nada a
# ele. Ser owner da WRITE_DAC, nao escrita de arquivo -- foi assim que a primeira execucao
# deste script falhou em `New-Item`.
# A correcao usa exatamente esse WRITE_DAC do owner para se conceder acesso. Nao e uma
# concessao nova de poder: Administradores ja pode tomar posse de qualquer objeto. A ausencia
# so tornava a arvore nao-administravel sem takeown -- inclusive para o rollback do plano.

param(
    # Conta dona da maquina, que recebe LEITURA para revisar o que a sessao fez.
    [string]$Dono = 'marce'
)

$ErrorActionPreference = 'Stop'

# ---- 0. Exige elevacao, e diz isso antes de falhar no meio -------------------
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
          [Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error 'Este script exige elevacao. Abra o PowerShell como Administrador e rode de novo.'
    exit 1
}

$raiz = 'C:\RayzenExec'
$ws   = Join-Path $raiz 'workspaces'

if (-not (Test-Path $raiz)) { Write-Error "Nao existe: $raiz. Rode scripts\criar-rayzenexec.ps1 antes."; exit 1 }

# ---- 1. Resolver principais por SID, nunca por nome --------------------------
# Licao de d1ec7ff: nome de grupo interno muda com o idioma do Windows. `Administradores`
# aqui e `Administrators` em outra maquina; o SID e o mesmo em toda instalacao.
$SID_SYSTEM  = 'S-1-5-18'
$SID_ADMINS  = 'S-1-5-32-544'
$SID_USERS   = 'S-1-5-32-545'   # o que NAO pode aparecer no resultado

try { $sidDono = (Get-LocalUser -Name $Dono).SID.Value }
catch { Write-Error "Conta '$Dono' nao encontrada. Passe -Dono <usuario>."; exit 1 }

try { $sidExec = (Get-LocalUser -Name 'RayzenExec').SID.Value }
catch { Write-Error "Conta 'RayzenExec' nao existe. Rode scripts\criar-rayzenexec.ps1 antes."; exit 1 }

if ((Get-LocalGroupMember -SID $SID_ADMINS | Where-Object { $_.SID.Value -eq $sidExec })) {
    Write-Error 'RayzenExec esta em Administradores. Isso viola o requisito 2 -- remova antes de continuar.'
    exit 1
}

# ---- 2. Garantir que Administradores alcanca a raiz ----------------------------
# Sem este passo, `New-Item` abaixo falha com acesso negado mesmo elevado.
$aclRaiz = & icacls $raiz
if ($aclRaiz -notmatch [regex]::Escape($SID_ADMINS) -and $aclRaiz -notmatch 'Administrador|Administrators') {
    Write-Output "raiz $raiz nao concede acesso a Administradores -- corrigindo (owner: $((Get-Acl $raiz).Owner))"
    & icacls $raiz /grant "*${SID_ADMINS}:(OI)(CI)F" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Nao consegui conceder acesso a Administradores em $raiz. Se persistir, tome posse: takeown /f `"$raiz`" /r /d s"
        exit 1
    }
    Write-Output 'raiz corrigida.'
} else {
    Write-Output 'raiz ja concede acesso a Administradores.'
}

# ---- 3. Criar ------------------------------------------------------------------
New-Item -ItemType Directory -Path $ws -Force | Out-Null
Write-Output "diretorio: $ws"

# ---- 4. ACL explicita ----------------------------------------------------------
# /inheritance:r remove as herdadas em vez de converte-las: nada entra por acidente do pai,
# hoje ou depois. Cada ACE abaixo esta ali por um motivo declarado.
& icacls $ws /inheritance:r | Out-Null
& icacls $ws /grant:r `
    "*${SID_SYSTEM}:(OI)(CI)F" `
    "*${SID_ADMINS}:(OI)(CI)F" `
    "*${sidDono}:(OI)(CI)R" `
    "*${sidExec}:(OI)(CI)M" | Out-Null

# ---- 5. Verificar o que foi feito, nao o que se pretendia ----------------------
$acl = & icacls $ws
Write-Output ''
Write-Output '== ACL resultante =='
$acl | Write-Output

$falhas = @()
if ($acl -match [regex]::Escape($SID_USERS) -or $acl -match 'Usu.rios:' -or $acl -match 'BUILTIN\\Users:') {
    $falhas += 'BUILTIN\Usuarios ainda tem acesso'
}
if ($acl -match 'CodexSandbox') { $falhas += 'CodexSandboxUsers ainda tem acesso' }
if ($acl -notmatch [regex]::Escape($sidExec) -and $acl -notmatch 'RayzenExec') {
    $falhas += 'RayzenExec NAO tem acesso -- a conta nao conseguiria trabalhar'
}

Write-Output ''
if ($falhas.Count -gt 0) {
    foreach ($f in $falhas) { Write-Warning $f }
    Write-Error 'O objetivo NAO foi atingido. Nao siga para o passo 2.'
    exit 1
}

Write-Output 'OK: workspaces criado com SYSTEM(F), Administradores(F), '"$Dono"'(R), RayzenExec(M).'
Write-Output 'OK: sem BUILTIN\Usuarios, sem CodexSandboxUsers.'
Write-Output ''
Write-Output 'Proximo passo (SEM elevacao, como '"$Dono"'):'
Write-Output '  powershell -ExecutionPolicy Bypass -File scripts\rayzenexec-2-semear-bundle.ps1'
