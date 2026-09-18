# Fecha os arquivos de segredo do repositorio para QUALQUER conta que nao seja voce.
#
# Nao exige elevacao: `marce` e owner desses arquivos, e owner tem WRITE_DAC.
#
# POR QUE ISTO EXISTE, ALEM DA LIMPEZA DE ACL DO REPO
#
# A limpeza (`icacls <repo> /reset /T`) tira as ACEs indevidas e devolve a heranca real. Mas a
# heranca de C:\Users\marce\Projects concede `CodexSandboxUsers:(RX)`, entao o repo continua
# LEGIVEL por duas contas locais. Para codigo isso e aceitavel; para `.env` nao.
#
# Aqui a heranca e REMOVIDA arquivo a arquivo: so voce, SYSTEM e Administradores. E a diferenca
# em relacao a proteger pela pasta e que segredo nao depende de onde mora -- medido em 09/09:
# a conta RayzenExec recebeu NEGADO em `C:\Users\marce\Projects` e LEU
# `C:\Users\marce\Projects\rayzen-ai\.env` dentro dele, porque o Windows concede *Bypass
# traverse checking* a todos e caminho absoluto nao exige permissao nos diretorios do meio.
#
# ORDEM IMPORTA: rode este script DEPOIS de qualquer `/reset` no repo. O reset restaura a
# heranca e apagaria o que aqui foi aplicado.
#
# LIMITE CONHECIDO, DECLARADO
# Arquivo sensivel NOVO nasce herdando a ACL permissiva. Este script e idempotente de proposito:
# rode de novo depois de criar um `.env` novo. Ele lista o que encontrou e o que fechou, entao a
# saida serve como conferencia -- nao ha "fechou tudo" silencioso.

param(
    # Somente relatorio, sem alterar nada.
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent

# `.example` NAO entra: e template versionado, sem segredo, e fecha-lo so criaria ruido.
$padroes = @('.env', '.env.local', '.env.*.local', 'hook.config.mjs', '*.pem', '*.pfx', '*.key', 'credentials.json')

$alvos = @()
foreach ($p in $padroes) {
    Get-ChildItem $repo -Recurse -File -Force -Filter $p -ErrorAction SilentlyContinue |
      Where-Object {
          $_.FullName -notlike "*$([char]92)node_modules$([char]92)*" -and
          $_.FullName -notlike "*$([char]92).git$([char]92)*" -and
          $_.Name -notlike '*.example'
      } | ForEach-Object { $alvos += $_.FullName }
}
$alvos = $alvos | Sort-Object -Unique

if ($alvos.Count -eq 0) { Write-Warning 'Nenhum arquivo de segredo encontrado -- confira os padroes.'; exit 1 }

$SID_SYSTEM = 'S-1-5-18'
$SID_ADMINS = 'S-1-5-32-544'
$sidDono    = ([System.Security.Principal.WindowsIdentity]::GetCurrent()).User.Value

Write-Output "repositorio: $repo"
Write-Output "arquivos de segredo encontrados: $($alvos.Count)"
Write-Output ''

$fechados = 0
$falhas   = @()
foreach ($a in $alvos) {
    $rel = $a.Substring($repo.Length + 1)
    $acl = & icacls $a
    $aberto = ($acl -match 'Usu.rios:' -or $acl -match 'BUILTIN\\Users:' -or $acl -match 'CodexSandbox' -or $acl -match 'S-1-5-21-')

    if ($DryRun) {
        "{0,-50} {1}" -f $rel, $(if ($aberto) { 'ABERTO -> fecharia' } else { 'ja fechado' })
        continue
    }

    if (-not $aberto) { "{0,-50} ja fechado" -f $rel; continue }

    & icacls $a /inheritance:r /grant:r "*${sidDono}:(F)" "*${SID_SYSTEM}:(F)" "*${SID_ADMINS}:(F)" 2>&1 | Out-Null
    $depois = & icacls $a
    if ($depois -match 'Usu.rios:' -or $depois -match 'BUILTIN\\Users:' -or $depois -match 'CodexSandbox' -or $depois -match 'S-1-5-21-(?!.*' + [regex]::Escape($sidDono.Split('-')[-1]) + ')') {
        $falhas += $rel
        "{0,-50} FALHOU" -f $rel
    } else {
        $fechados++
        "{0,-50} fechado" -f $rel
    }
}

Write-Output ''
if ($DryRun) { Write-Output 'DryRun: nada foi alterado.'; exit 0 }
Write-Output "fechados agora: $fechados"
if ($falhas.Count -gt 0) {
    foreach ($f in $falhas) { Write-Warning "nao fechou: $f" }
    exit 1
}
Write-Output 'OK: nenhum arquivo de segredo concede acesso a outra conta local.'
