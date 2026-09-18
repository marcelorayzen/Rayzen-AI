# Roda como `marce`, SEM elevacao. Depois do login do passo 5.
#
# Responde as DUAS perguntas do teste 1 do plano, e a segunda e a que tem risco declarado:
#
#   a) o Claude Code autentica e responde DENTRO da conta RayzenExec?
#   b) a sua sessao continua funcionando AO MESMO TEMPO?
#
# (b) e o risco registrado em "6. Riscos": se a assinatura nao permitir duas contas de SO
# logadas, o sintoma provavel e a SUA sessao cair. Por isso o script mede a sua sessao ANTES
# e DEPOIS da chamada na outra conta, em vez de so olhar para o resultado de la.
#
# Se o login nao funcionou ou o plano restringe: PARE E RELATE. Nao trocar por API key.

param(
    [string]$Senha = (Join-Path $env:USERPROFILE 'rayzenexec-senha.txt'),
    [string]$Drop  = 'C:\Users\Public\rayzen-drop'
)

$ErrorActionPreference = 'Stop'

$raiz = 'C:\RayzenExec'
$ws   = Join-Path $raiz 'workspaces\rayzen-ai'
$log  = Join-Path $raiz 'logs\validar-claude.txt'

if (-not (Test-Path $Senha)) { Write-Error "Arquivo de senha nao encontrado: $Senha"; exit 1 }
if (-not (Test-Path $ws))    { Write-Error "Workspace nao existe: $ws."; exit 1 }

# ---- (b) parte 1: a SUA sessao esta viva agora? --------------------------------
# Medido pelo processo do agent, que e o que morre de forma observavel se a assinatura
# derrubar a sessao do dono.
#
# CORRIGIDO EM 11/09 -- ate aqui este filtro NAO PEGAVA O AGENT.
#
# Ele procurava `*dist\index.js*`, com barra INVERTIDA. A linha de comando real e
# `node  dist/index.js`, com barra normal e relativa -- sem sequer a palavra "rayzen"
# dentro. Resultado: o filtro casava os servidores MCP e o widget, e o veredito
# "a sessao do dono: 1 -> 1 processo" de 09/09 mediu tres processos que NAO eram o alvo
# da pergunta. Nada caiu, entao a conclusao continua valendo -- mas ela valia por sorte,
# nao por medicao.
#
# Agora casa as duas grafias, e devolve o agent SEPARADO do resto: um numero agregado
# esconde exatamente o caso que importa (o agent morre, um MCP sobe, o total nao muda).
function Get-SessaoDoDono {
    $todos = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue
    $agent = @($todos | Where-Object {
        $_.CommandLine -like '*dist/index.js*' -or $_.CommandLine -like '*dist\index.js*'
    }).Count
    $outros = @($todos | Where-Object { $_.CommandLine -like '*rayzen*' }).Count
    return [pscustomobject]@{ Agent = $agent; Outros = $outros }
}
$antes = Get-SessaoDoDono
Write-Output "sessao do dono antes: agent=$($antes.Agent)  outros node do Rayzen=$($antes.Outros)"
if ($antes.Agent -eq 0) {
    # Zero e INCONCLUSIVO, nao sucesso: sem agent rodando, "ele nao caiu" nao prova nada.
    Write-Warning 'O agent NAO esta rodando agora -- este teste nao tem o que medir. Suba o agent antes.'
}

# ---- (a) a conta responde? ------------------------------------------------------
$marca = [guid]::NewGuid().ToString()
$feito = Join-Path $raiz 'logs\validar-claude.done'
$aux   = Join-Path $Drop 'rayzenexec-validar.ps1'
@"
`$ErrorActionPreference = 'Continue'
Start-Transcript -Path '$log' -Force | Out-Null
`$npm = Join-Path `$env:APPDATA 'npm'
if (Test-Path `$npm) { `$env:PATH = "`$npm;`$env:PATH" }
Set-Location '$ws'
Write-Output ('quem: ' + (whoami))
Write-Output ('versao: ' + ((& claude --version 2>&1) -join ' '))
Write-Output '--- claude -p ---'
& claude -p "responda apenas: ok" 2>&1 | ForEach-Object { Write-Output `$_ }
Write-Output '--- fim ---'
Stop-Transcript | Out-Null
Set-Content -Path '$feito' -Value '$marca' -Encoding ascii
"@ | Set-Content -Path $aux -Encoding utf8

$sec  = ConvertTo-SecureString (Get-Content $Senha -Raw).Trim() -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential("$env:COMPUTERNAME\RayzenExec", $sec)

Write-Output 'chamando o Claude dentro da conta RayzenExec...'
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
    Start-Sleep -Seconds 3
}
$concluiu = (Test-Path $feito) -and ((Get-Content $feito -Raw -ErrorAction SilentlyContinue).Trim() -eq $marca)

Remove-Item $aux -Force -ErrorAction SilentlyContinue

# ---- (b) parte 2: a sua sessao sobreviveu? --------------------------------------
Start-Sleep -Seconds 3
$depois = Get-SessaoDoDono

Write-Output ''
if (Test-Path $log) { Write-Output '== saida da conta =='; Get-Content $log } else { Write-Warning "Sem log em $log" }

Write-Output ''
Write-Output '== veredito =='
if (-not $concluiu) { Write-Warning 'A conta nao sinalizou conclusao -- resultado abaixo pode estar parcial.' }
Write-Output "  agent do dono:  $($antes.Agent) -> $($depois.Agent)"
Write-Output "  outros node:    $($antes.Outros) -> $($depois.Outros)"
if ($antes.Agent -eq 0) {
    Write-Warning '  INCONCLUSIVO: nao havia agent rodando antes. Nao da para afirmar que nada caiu.'
} elseif ($depois.Agent -lt $antes.Agent) {
    Write-Warning '  A SUA SESSAO PERDEU PROCESSOS durante a chamada.'
    Write-Warning '  E o risco registrado: a assinatura pode nao permitir duas contas ao mesmo tempo.'
    Write-Warning '  PARE E RELATE. Nao contornar com ANTHROPIC_API_KEY.'
} else {
    Write-Output '  OK: a sessao do dono nao perdeu processos.'
}
Write-Output ''
Write-Output 'Se a saida acima trouxer erro de autenticacao ou restricao de plano,'
Write-Output 'PARE e relate o texto exato -- e o criterio acordado no plano.'
