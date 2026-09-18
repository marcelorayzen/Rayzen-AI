# Roda como `marce`, SEM elevacao. Executa a bateria DENTRO da conta RayzenExec.
#
# Responde a pergunta que o plano deixou em aberto: a conta trabalha no workspace autorizado
# e SO nele? Cada alvo e testado abrindo de verdade, e o resultado distingue tres estados:
#
#   NEGADO       -> UnauthorizedAccessException. E o que se quer.
#   LEU          -> falha: o isolamento nao existe para aquele alvo.
#   INCONCLUSIVO -> o alvo nao existe. Nao prova nada, e nao pode ser contado como sucesso.
#
# A distincao importa porque `Test-Path` devolve False nos dois primeiros casos: um alvo que
# sumiu pareceria isolamento funcionando. Por isso a lista de alvos e conferida AQUI, como
# voce (que enxerga os caminhos), e so os que realmente existem sao enviados para o teste.

param(
    [string]$Drop  = 'C:\Users\Public\rayzen-drop',
    [string]$Senha = (Join-Path $env:USERPROFILE 'rayzenexec-senha.txt')
)

$ErrorActionPreference = 'Stop'

$raiz    = 'C:\RayzenExec'
$destino = Join-Path $raiz 'workspaces\rayzen-ai'
$log     = Join-Path $raiz 'logs\testes-isolamento.txt'

if (-not (Test-Path $Senha)) { Write-Error "Arquivo de senha nao encontrado: $Senha"; exit 1 }

# ---- Alvos que DEVEM ser negados, conferidos por quem os enxerga ----------------
$candidatos = @(
    (Join-Path $env:USERPROFILE '.env'),
    (Join-Path $env:USERPROFILE '.ssh\id_ed25519'),
    (Join-Path $env:USERPROFILE '.claude\.credentials.json'),
    (Join-Path $env:USERPROFILE 'Projects'),
    (Join-Path $env:USERPROFILE 'Projects\rayzen-ai\.env'),
    (Join-Path $env:USERPROFILE 'Projects\rayzen-ai\apps\agent\src\hooks\hook.config.mjs'),
    (Join-Path $env:USERPROFILE 'Desktop'),
    $Senha
)
$alvos = @()
foreach ($c in $candidatos) { if (Test-Path -LiteralPath $c) { $alvos += $c } else { Write-Warning "alvo ausente, fora da bateria: $c" } }
if ($alvos.Count -eq 0) { Write-Error 'Nenhum alvo existe -- a bateria nao mediria nada.'; exit 1 }

$listaAlvos = ($alvos | ForEach-Object { "'" + $_.Replace("'","''") + "'" }) -join ",`n  "

# ---- Bateria, executada dentro da conta -----------------------------------------
# Espera pela MARCA, nao por `-Wait`: `Start-Process -Credential -Wait` lanca "Acesso negado"
# ao monitorar processo de outro usuario, mesmo tendo criado e rodado ate o fim. E a marca e
# um GUID desta execucao porque `marce` so tem LEITURA em C:\RayzenExec e nao pode limpar um
# sentinela antigo -- que seria lido como sucesso desta rodada.
$marca = [guid]::NewGuid().ToString()
$feito = Join-Path $raiz 'logs\testes.done'
$aux   = Join-Path $Drop 'rayzenexec-testes.ps1'
@"
`$ErrorActionPreference = 'Continue'
Start-Transcript -Path '$log' -Force | Out-Null

`$falhas = 0
function Resultado(`$nome, `$ok, `$detalhe) {
    if (`$ok -eq `$true)      { Write-Output ("  OK           " + `$nome + "  " + `$detalhe) }
    elseif (`$ok -eq `$null)  { Write-Output ("  INCONCLUSIVO " + `$nome + "  " + `$detalhe) }
    else { Write-Output ("  FALHA        " + `$nome + "  " + `$detalhe); `$script:falhas++ }
}

Write-Output '=== 1. identidade ==='
`$eu = (whoami)
Resultado 'roda como RayzenExec' (`$eu -match 'rayzenexec') `$eu

Write-Output ''
Write-Output '=== 2. privilegio ==='
`$grupos = whoami /groups
`$admin = (`$grupos -match 'S-1-5-32-544')
Resultado 'NAO esta em Administradores' (-not `$admin) ''

Write-Output ''
Write-Output '=== 3. alvos que devem ser NEGADOS ==='
`$alvos = @(
  $listaAlvos
)
foreach (`$a in `$alvos) {
    try {
        if (Test-Path -LiteralPath `$a -PathType Container) { Get-ChildItem -LiteralPath `$a -Force -ErrorAction Stop | Out-Null }
        else { [System.IO.File]::ReadAllBytes(`$a) | Out-Null }
        Resultado 'negado' `$false ("LEU -> " + `$a)
    } catch [System.UnauthorizedAccessException] {
        Resultado 'negado' `$true `$a
    } catch {
        `$msg = `$_.Exception.Message
        if (`$msg -match 'negad|denied') { Resultado 'negado' `$true `$a }
        else { Resultado 'negado' `$null (`$a + '  -> ' + `$msg) }
    }
}

Write-Output ''
Write-Output '=== 4. o workspace autorizado FUNCIONA ==='
`$ws = '$destino'
try {
    `$p = Join-Path `$ws '.sonda-escrita'
    [System.IO.File]::WriteAllText(`$p, 'ok')
    Remove-Item `$p -Force
    Resultado 'escreve no workspace' `$true `$ws
} catch { Resultado 'escreve no workspace' `$false `$_.Exception.Message }

Write-Output ''
Write-Output '=== 5. o workspace nasceu SEM segredo ==='
`$padroes = @('.env','*.env','id_ed25519*','*.pem','*.pfx','*.key','credentials*','hook.config.mjs','.credentials.json')
`$achados = @()
foreach (`$p in `$padroes) {
    Get-ChildItem -LiteralPath `$ws -Recurse -Force -Filter `$p -ErrorAction SilentlyContinue |
      Where-Object { `$_.FullName -notlike '*\.git\*' } |
      ForEach-Object { `$achados += `$_.FullName }
}
if (`$achados.Count -eq 0) { Resultado 'sem segredo no workspace' `$true '' }
else { foreach (`$x in `$achados) { Resultado 'sem segredo no workspace' `$false `$x } }

Write-Output ''
Write-Output '=== 6. o ambiente da sessao nao carrega credencial ==='
`$vars = Get-ChildItem env: | Where-Object { `$_.Name -match 'TOKEN|SECRET|PASSWORD|PASSWD|KEY|CREDENTIAL' }
if (`$vars) { foreach (`$v in `$vars) { Resultado 'ambiente limpo' `$false `$v.Name } }
else { Resultado 'ambiente limpo' `$true '0 variaveis' }

Write-Output ''
Write-Output '=== 7. Claude Code na conta ==='
# `Start-Process -Credential` NAO carrega o PATH de usuario do perfil alvo -- ele herda o
# ambiente de sistema. O CLI foi instalado por usuario, entao `claude` nu nao resolve mesmo
# estando instalado. Procurar pelo caminho mede a instalacao; procurar pelo nome media o PATH.
`$cands = @(
    (Join-Path `$env:APPDATA 'npm\claude.cmd'),
    (Join-Path `$env:APPDATA 'npm\claude.ps1'),
    (Join-Path `$env:USERPROFILE '.npm-global\claude.cmd'),
    (Join-Path `$env:LOCALAPPDATA 'Programs\claude\claude.exe')
)
`$exe = `$cands | Where-Object { Test-Path `$_ } | Select-Object -First 1
if (-not `$exe) {
    Resultado 'claude instalado' `$false ('nao encontrado em: ' + (`$cands -join ' ; '))
    `$npm = Join-Path `$env:APPDATA 'npm'
    if (Test-Path `$npm) { Write-Output ('   conteudo de ' + `$npm + ': ' + ((Get-ChildItem `$npm -Force | Select-Object -Expand Name) -join ', ')) }
} else {
    try {
        `$v = & cmd /c "`"`$exe`" --version" 2>&1
        Resultado 'claude responde' `$true ((`$v -join ' ') + '   [' + `$exe + ']')
    } catch { Resultado 'claude responde' `$false (`$_.Exception.Message + '  [' + `$exe + ']') }
}

Write-Output ''
Write-Output ("RESUMO: " + `$falhas + " falha(s)")
Stop-Transcript | Out-Null
Set-Content -Path '$feito' -Value '$marca' -Encoding ascii
"@ | Set-Content -Path $aux -Encoding utf8

$sec  = ConvertTo-SecureString (Get-Content $Senha -Raw).Trim() -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential("$env:COMPUTERNAME\RayzenExec", $sec)

Write-Output 'executando a bateria dentro da conta RayzenExec...'
try {
    Start-Process -FilePath 'powershell.exe' `
                  -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$aux`"" `
                  -Credential $cred -WorkingDirectory $raiz -WindowStyle Hidden -ErrorAction Stop
} catch {
    Write-Output "aviso do Start-Process: $($_.Exception.Message)"
}

$limite = (Get-Date).AddMinutes(5)
while ((Get-Date) -lt $limite) {
    if ((Test-Path $feito) -and ((Get-Content $feito -Raw -ErrorAction SilentlyContinue).Trim() -eq $marca)) { break }
    Start-Sleep -Seconds 2
}
$concluiu = (Test-Path $feito) -and ((Get-Content $feito -Raw -ErrorAction SilentlyContinue).Trim() -eq $marca)
if (-not $concluiu) { Write-Warning 'A conta nao sinalizou conclusao em 5 min -- o log abaixo pode estar parcial.' }

Remove-Item $aux -Force -ErrorAction SilentlyContinue

Write-Output ''
if (Test-Path $log) { Get-Content $log } else { Write-Error "Sem log em $log -- a sessao nao iniciou."; exit 1 }
