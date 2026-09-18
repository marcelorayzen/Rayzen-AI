# Roda como `marce`, SEM elevacao. Exercita o CANAL DE VOLTA.
#
# A conta RayzenExec faz uma alteracao no proprio clone, commita, e entrega o trabalho como
# `git bundle` em C:\RayzenExec\outbox. O dono le esse bundle e INSPECIONA -- sem mesclar.
#
# POR QUE BUNDLE E NAO UM REMOTO COMPARTILHADO
# O clone da conta nao tem remoto (removido no passo 3) e o dono nao pode -- nem deve -- rodar
# git dentro da arvore dela: o proprio git recusa com "dubious ownership", porque um
# `.git/config` escrito pela outra conta seria executado com a identidade de quem roda o
# comando. O bundle atravessa a fronteira como DADO, nao como repositorio.
#
# O bundle e INCREMENTAL (base..main): so os commits novos. Alem de menor, isso torna a
# verificacao honesta -- um bundle completo "aplicaria" mesmo se a base tivesse divergido.
#
# NADA E MESCLADO AQUI. O contrato do plano e: o dono revisa e traz, nunca automatico.

param(
    [string]$Senha = (Join-Path $env:USERPROFILE 'rayzenexec-senha.txt'),
    [string]$Drop  = 'C:\Users\Public\rayzen-drop',
    # Commit que as duas arvores compartilham. Padrao: o HEAD do clone no passo 3.
    [string]$Base  = '1e88672'
)

$ErrorActionPreference = 'Stop'

$raiz   = 'C:\RayzenExec'
$ws     = Join-Path $raiz 'workspaces\rayzen-ai'
$outbox = Join-Path $raiz 'outbox'
$log    = Join-Path $raiz 'logs\roundtrip.txt'
$repo   = Split-Path $PSScriptRoot -Parent

if (-not (Test-Path $Senha)) { Write-Error "Arquivo de senha nao encontrado: $Senha"; exit 1 }
if (-not (Test-Path $ws))    { Write-Error "Workspace nao existe: $ws"; exit 1 }

# A base precisa existir do LADO DO DONO, senao a verificacao nao tem contra o que medir.
$temBase = & git -C $repo cat-file -t $Base 2>&1
if ($LASTEXITCODE -ne 0) { Write-Error "A base '$Base' nao existe no seu repositorio. Passe -Base <sha> comum as duas arvores."; exit 1 }

$git = (Get-Command git -ErrorAction SilentlyContinue).Source
if (-not $git) { $git = 'C:\Program Files\Git\cmd\git.exe' }

$carimbo = Get-Date -Format 'yyyyMMdd-HHmmss'
$bundle  = Join-Path $outbox "rayzen-ai-$carimbo.bundle"
$marca   = [guid]::NewGuid().ToString()
$feito   = Join-Path $raiz 'logs\roundtrip.done'
$aux     = Join-Path $Drop 'rayzenexec-roundtrip.ps1'

@"
`$ErrorActionPreference = 'Continue'
Start-Transcript -Path '$log' -Force | Out-Null
Write-Output ('quem: ' + (whoami))
Set-Location '$ws'

# Alteracao de teste: um arquivo que existe para provar o transporte, e diz isso.
`$arquivo = 'docs\decisions\roundtrip-rayzenexec.md'
`$conteudo = @(
  '# Round-trip do canal de volta'
  ''
  'Escrito pela conta RayzenExec em $carimbo, dentro de C:\RayzenExec\workspaces\rayzen-ai.'
  'Existe para provar que trabalho feito na conta isolada atravessa por `git bundle` e chega'
  'ao dono para revisao -- sem remoto compartilhado e sem o dono rodar git na arvore dela.'
  ''
  'Pode ser apagado depois da verificacao.'
) -join [Environment]::NewLine
Set-Content -Path `$arquivo -Value `$conteudo -Encoding utf8

& '$git' add `$arquivo
& '$git' commit -m 'test(rayzenexec): round-trip do canal de volta pelo outbox' | Out-Null
Write-Output ('HEAD apos commit: ' + (& '$git' rev-parse --short HEAD))
Write-Output ('autor: ' + (& '$git' log -1 --format='%an <%ae>'))

New-Item -ItemType Directory -Path '$outbox' -Force | Out-Null
& '$git' bundle create '$bundle' '$Base..HEAD'
Write-Output ('bundle: $bundle')
& '$git' bundle verify '$bundle'
Stop-Transcript | Out-Null
Set-Content -Path '$feito' -Value '$marca' -Encoding ascii
"@ | Set-Content -Path $aux -Encoding utf8

$sec  = ConvertTo-SecureString (Get-Content $Senha -Raw).Trim() -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential("$env:COMPUTERNAME\RayzenExec", $sec)

Write-Output 'a conta esta produzindo o commit e o bundle...'
try {
    Start-Process -FilePath 'powershell.exe' `
                  -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$aux`"" `
                  -Credential $cred -WorkingDirectory $raiz -WindowStyle Hidden -ErrorAction Stop
} catch { Write-Output "aviso do Start-Process: $($_.Exception.Message)" }

$limite = (Get-Date).AddMinutes(5)
while ((Get-Date) -lt $limite) {
    if ((Test-Path $feito) -and ((Get-Content $feito -Raw -ErrorAction SilentlyContinue).Trim() -eq $marca)) { break }
    Start-Sleep -Seconds 2
}
Remove-Item $aux -Force -ErrorAction SilentlyContinue

Write-Output ''
if (Test-Path $log) { Write-Output '== saida da conta =='; Get-Content $log | Where-Object { $_ -notmatch '^\*\*\*|PSVersion|BuildVersion|CLRVersion|WSManStack|PSRemoting|Serialization|PSCompatible|PSEdition|Nome da|Aplicativo Host|Hora de|Computador:|Executar como|^$' } }

Write-Output ''
Write-Output '== o dono recebe: verificacao SEM MESCLAR =='
if (-not (Test-Path $bundle)) { Write-Error "Bundle nao chegou em $bundle"; exit 1 }
"  arquivo: $bundle ({0:N1} KB)" -f ((Get-Item $bundle).Length / 1KB)

# `bundle verify` responde a pergunta que importa: os pre-requisitos existem no MEU repo?
& git -C $repo bundle verify $bundle
if ($LASTEXITCODE -ne 0) { Write-Error 'bundle verify falhou -- nao aplicar.'; exit 1 }

Write-Output ''
Write-Output '  commits que ele traz:'
& git -C $repo bundle list-heads $bundle | ForEach-Object { "    $_" }

# FETCH para um ref isolado, nunca merge. O trabalho fica enderecavel e revisavel, e a sua
# arvore continua exatamente onde estava.
$ref = "refs/rayzenexec/$carimbo"
& git -C $repo fetch --quiet $bundle "HEAD:$ref"
Write-Output ''
Write-Output "  buscado para $ref (sua arvore NAO foi tocada):"
& git -C $repo log --oneline -3 $ref | ForEach-Object { "    $_" }
Write-Output ''
Write-Output '  diff contra a sua base:'
& git -C $repo diff --stat "$Base..$ref" | ForEach-Object { "    $_" }

Write-Output ''
Write-Output "  para ver o conteudo:  git show $ref"
Write-Output "  para descartar:       git update-ref -d $ref"
Write-Output '  NADA foi mesclado -- trazer e decisao sua.'
