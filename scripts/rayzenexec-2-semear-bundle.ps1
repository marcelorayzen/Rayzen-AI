# Roda como `marce`, SEM elevacao, de dentro do repositorio.
#
# Produz um `git bundle` do repositorio e o entrega no canal C:\Users\Public\rayzen-drop,
# de onde a conta RayzenExec clona no passo 3.
#
# POR QUE BUNDLE, E NAO WORKTREE NEM CLONE DIRETO
#   worktree  -> grava um `.git` que APONTA para C:\Users\marce\...\.git e compartilha o object
#                store. RayzenExec nao le o perfil do dono: o worktree quebraria em toda operacao
#                git, e se lesse seria o oposto de isolamento.
#   clone do GitHub -> repo privado. A conta nao tem credencial, e dar uma violaria o requisito
#                de nao copiar credencial.
#   clone da sua copia -> a conta nao le C:\Users\marce\Projects. E o ponto do desenho.
#   bundle    -> carrega SOMENTE objetos versionados. `.env` (`*.env`) e `.claude/*` sao
#                gitignored e nao rastreados, entao nao ha caminho para eles entrarem.
#                Este script VERIFICA isso clonando o bundle e auditando, em vez de presumir.

param(
    [string]$Branch = 'main',
    [string]$Drop   = 'C:\Users\Public\rayzen-drop'
)

$ErrorActionPreference = 'Stop'

$repo = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path (Join-Path $repo '.git'))) { Write-Error "Nao e um repositorio git: $repo"; exit 1 }

# ---- 1. O bundle so carrega o que esta COMMITADO. Avisar se ha trabalho fora --
$sujo = & git -C $repo status --porcelain
if ($sujo) {
    Write-Warning 'Arvore suja -- o bundle leva apenas o que esta commitado:'
    $sujo | Select-Object -First 20 | Write-Output
    Write-Output ''
}

$ref = & git -C $repo rev-parse --verify --quiet "refs/heads/$Branch"
if (-not $ref) { Write-Error "Branch '$Branch' nao existe neste repositorio."; exit 1 }

# ---- 2. Gerar -------------------------------------------------------------------
New-Item -ItemType Directory -Path $Drop -Force | Out-Null
$bundle = Join-Path $Drop 'rayzen-ai.bundle'

Write-Output "gerando bundle de '$Branch' ($($ref.Substring(0,7)))..."
& git -C $repo bundle create $bundle $Branch
if ($LASTEXITCODE -ne 0) { Write-Error 'git bundle create falhou.'; exit 1 }

& git -C $repo bundle verify $bundle | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Error 'git bundle verify falhou -- bundle corrompido.'; exit 1 }
Write-Output ("bundle: {0} ({1:N1} MB)" -f $bundle, ((Get-Item $bundle).Length / 1MB))

# ---- 3. AUDITAR o conteudo, em vez de confiar no gitignore ---------------------
# Requisito 8: o workspace nao pode nascer com segredo. A unica forma de saber e abrir.
$aud = Join-Path $env:TEMP ('rayzen-bundle-auditoria-' + [guid]::NewGuid().ToString('N').Substring(0,8))
& git clone --quiet --branch $Branch $bundle $aud 2>&1 | Out-Null
if (-not (Test-Path $aud)) { Write-Error 'Nao consegui clonar o bundle para auditar.'; exit 1 }

# Audita ARQUIVO, nunca nome de diretorio. A primeira versao barrava o diretorio `.claude`
# inteiro e reprovou o bundle por causa de `.claude/agents/*.md` -- seis definicoes de subagente
# versionadas DE PROPOSITO (`!/.claude/agents/` no .gitignore). O requisito e ausencia de
# CREDENCIAL, e um diretorio nao e credencial: casar pelo nome do container confunde as duas.
$padroes = @('.env', '*.env', 'id_ed25519*', '*.pem', '*.pfx', '*.key', '*.pub',
             'credentials*', '.credentials.json', 'settings.local.json',
             'hook.config.mjs', 'rayzenexec-senha.txt', '*.pfx', 'known_hosts')
$achados = @()
foreach ($p in $padroes) {
    $hits = Get-ChildItem -LiteralPath $aud -Recurse -File -Force -Filter $p -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -notlike '*\.git\*' }
    foreach ($h in $hits) { $achados += $h.FullName.Substring($aud.Length + 1) }
}

# Sob `.claude/`, so `agents/` e esperado. Qualquer outro arquivo ali e sinalizado pelo caminho,
# que e mais estreito que barrar o diretorio e mais largo que listar nomes conhecidos.
$claudeDir = Join-Path $aud '.claude'
if (Test-Path $claudeDir) {
    Get-ChildItem -LiteralPath $claudeDir -Recurse -File -Force -ErrorAction SilentlyContinue |
      ForEach-Object {
          $rel = $_.FullName.Substring($aud.Length + 1)
          if ($rel -notlike '.claude\agents\*') { $achados += $rel }
      }
}
$achados = $achados | Sort-Object -Unique
$arquivos = (Get-ChildItem -LiteralPath $aud -Recurse -File -Force -ErrorAction SilentlyContinue |
             Where-Object { $_.FullName -notlike '*\.git\*' }).Count

Remove-Item -LiteralPath $aud -Recurse -Force -ErrorAction SilentlyContinue

Write-Output ''
Write-Output "== auditoria do bundle ($arquivos arquivos) =="
if ($achados.Count -gt 0) {
    foreach ($a in $achados) { Write-Warning "SENSIVEL NO BUNDLE: $a" }
    Write-Error 'O bundle carrega arquivo sensivel. NAO siga para o passo 3.'
    exit 1
}
Write-Output 'OK: nenhum .env, credencial, chave ou config de hook no bundle.'

# ---- 4. Fechar o arquivo no canal publico --------------------------------------
# C:\Users\Public e legivel por qualquer conta local por padrao, e o codigo aqui e privado.
# Como `marce` e o OWNER do arquivo recem-criado, tem WRITE_DAC nele: da para restringir
# sem elevacao. Se falhar, o script avisa em vez de deixar aberto em silencio.
try {
    $sidExec = (Get-LocalUser -Name 'RayzenExec').SID.Value
    & icacls $bundle /inheritance:r | Out-Null
    & icacls $bundle /grant:r "$($env:USERNAME):(R,W)" "*${sidExec}:(R)" | Out-Null
    Write-Output 'OK: bundle restrito a voce (RW) e RayzenExec (R).'
} catch {
    Write-Warning "Nao consegui restringir o ACL do bundle: $($_.Exception.Message)"
    Write-Warning 'O arquivo esta legivel por qualquer conta local ate o passo 3 apaga-lo.'
}

Write-Output ''
Write-Output 'Proximo passo (como voce, SEM elevacao):'
Write-Output '  powershell -ExecutionPolicy Bypass -File scripts\rayzenexec-3-clonar-na-conta.ps1'
