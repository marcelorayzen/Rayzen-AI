# Roda como `marce`, SEM elevacao.
#
# Faz a conta RayzenExec clonar o bundle para o proprio workspace. O clone e executado
# DENTRO da conta (Start-Process -Credential), nunca como voce: assim os arquivos nascem
# com a conta como criadora e nada do seu contexto entra junto.
#
# Start-Process -Credential e o caminho porque a tarefa agendada NAO roda: falta o direito
# "Log on as a batch job", que exige elevacao para conceder. Medido em 09/09 (erro 267011).

param(
    [string]$Drop     = 'C:\Users\Public\rayzen-drop',
    [string]$Senha    = (Join-Path $env:USERPROFILE 'rayzenexec-senha.txt'),
    [switch]$ManterBundle
)

$ErrorActionPreference = 'Stop'

$raiz    = 'C:\RayzenExec'
$ws      = Join-Path $raiz 'workspaces'
$destino = Join-Path $ws   'rayzen-ai'
$bundle  = Join-Path $Drop 'rayzen-ai.bundle'
$log     = Join-Path $raiz 'logs\clone.txt'

if (-not (Test-Path $ws))     { Write-Error "Nao existe: $ws. Rode o passo 1 (elevado) antes."; exit 1 }
if (-not (Test-Path $bundle)) { Write-Error "Nao existe: $bundle. Rode o passo 2 antes."; exit 1 }
if (Test-Path $destino)       { Write-Error "Destino JA existe: $destino. Resolva antes (a conta pode ter trabalho la)."; exit 1 }
if (-not (Test-Path $Senha))  { Write-Error "Arquivo de senha nao encontrado: $Senha"; exit 1 }

# ---- Credencial ----------------------------------------------------------------
# A senha nunca vai para o terminal, para log, nem para a linha de comando do processo.
$sec  = ConvertTo-SecureString (Get-Content $Senha -Raw).Trim() -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential("$env:COMPUTERNAME\RayzenExec", $sec)

# ---- git por caminho absoluto ---------------------------------------------------
# O ambiente da sessao da outra conta nao e o seu; nao presumir PATH.
$git = (Get-Command git -ErrorAction SilentlyContinue).Source
if (-not $git) { $git = 'C:\Program Files\Git\cmd\git.exe' }
if (-not (Test-Path $git)) { Write-Error 'git.exe nao encontrado.'; exit 1 }

# ---- O que a conta vai executar --------------------------------------------------
# Fica no drop porque a conta nao le o seu perfil nem o repositorio.
#
# ESPERA POR MARCA, NAO POR `-Wait`. Medido em 09/09: `Start-Process -Credential -Wait` lanca
# "Acesso negado" ao tentar monitorar um processo de OUTRO usuario -- depois de cria-lo e de ele
# rodar ate o fim. O clone tinha terminado (HEAD 1e88672) e o script abortou na verificacao.
# Esperar pelo mecanismo dava falso negativo; esperar pelo RESULTADO nao da.
#
# A marca e um GUID que so esta execucao conhece. Precisa ser assim porque `marce` tem apenas
# LEITURA em C:\RayzenExec: nao da para apagar um sentinela antes de comecar, entao um arquivo
# de uma execucao anterior seria lido como sucesso desta.
$marca = [guid]::NewGuid().ToString()
$feito = Join-Path $raiz 'logs\clone.done'
$aux   = Join-Path $Drop 'rayzenexec-clone.ps1'
@"
`$ErrorActionPreference = 'Continue'
Start-Transcript -Path '$log' -Force | Out-Null
Write-Output ('quem: ' + (whoami))
New-Item -ItemType Directory -Path '$raiz\outbox' -Force | Out-Null
& '$git' clone --branch main '$bundle' '$destino'
Set-Location '$destino'
# O remoto aponta para um bundle que sera apagado. Remover evita um `git pull` que mente.
& '$git' remote remove origin
& '$git' config user.name  'RayzenExec'
& '$git' config user.email 'rayzenexec@localhost'
Write-Output ('HEAD: ' + (& '$git' rev-parse --short HEAD))
Write-Output ('branch: ' + (& '$git' rev-parse --abbrev-ref HEAD))
Stop-Transcript | Out-Null
Set-Content -Path '$feito' -Value '$marca' -Encoding ascii
"@ | Set-Content -Path $aux -Encoding utf8

Write-Output 'clonando dentro da conta RayzenExec...'
try {
    Start-Process -FilePath 'powershell.exe' `
                  -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$aux`"" `
                  -Credential $cred -WorkingDirectory $raiz -WindowStyle Hidden -ErrorAction Stop
} catch {
    # Nao aborta: o processo pode ter subido mesmo assim. Quem decide e a marca, abaixo.
    Write-Output "aviso do Start-Process: $($_.Exception.Message)"
}

$limite = (Get-Date).AddMinutes(5)
while ((Get-Date) -lt $limite) {
    if ((Test-Path $feito) -and ((Get-Content $feito -Raw -ErrorAction SilentlyContinue).Trim() -eq $marca)) { break }
    Start-Sleep -Seconds 2
}
if (-not ((Test-Path $feito) -and ((Get-Content $feito -Raw -ErrorAction SilentlyContinue).Trim() -eq $marca))) {
    Write-Warning 'A conta nao sinalizou conclusao em 5 min. O log abaixo diz ate onde foi.'
}

Remove-Item $aux -Force -ErrorAction SilentlyContinue

# ---- Verificar pelo resultado, nao pelo codigo de saida --------------------------
Write-Output ''
Write-Output '== log da conta =='
if (Test-Path $log) { Get-Content $log } else { Write-Warning "Sem log em $log -- a sessao pode nao ter iniciado." }

Write-Output ''
if (Test-Path (Join-Path $destino '.git')) {
    $n = (Get-ChildItem $destino -Recurse -File -Force -ErrorAction SilentlyContinue).Count
    Write-Output "OK: workspace clonado em $destino ($n arquivos)"
    $dono = (Get-Acl $destino).Owner
    Write-Output "owner do clone: $dono   (esperado: ...\RayzenExec)"
} else {
    Write-Error "O clone NAO chegou em $destino. Veja o log acima antes de seguir."
    exit 1
}

if (-not $ManterBundle) {
    Remove-Item $bundle -Force -ErrorAction SilentlyContinue
    Write-Output 'bundle apagado do canal publico (use -ManterBundle para conservar).'
}

Write-Output ''
Write-Output 'Proximo passo:'
Write-Output '  powershell -ExecutionPolicy Bypass -File scripts\rayzenexec-4-testes-isolamento.ps1'
