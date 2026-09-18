# Roda como o DONO (`marce`), sem elevacao. Chamado pelo agent, por `execFile` -- caminho no
# argv, nunca uma string de comando.
#
# E a ponte entre o agent, que roda como o dono, e a sessao, que precisa rodar como RayzenExec.
# O Node nao sabe trocar de usuario; `Start-Process -Credential` sabe, e foi o caminho validado
# em 09/09 (a tarefa agendada NAO executa: falta "Log on as a batch job", que exige elevacao
# para conceder -- erro 267011, "task has not yet run").
#
# ## O que este script NAO faz
#
# Nao interpreta o prompt, nao monta comando com ele, nao o ve. O conteudo da sessao ja esta
# em arquivo dentro de `-Trabalho` quando ele e chamado; aqui so trafegam caminhos.
#
# ## A senha
#
# Vem do arquivo que so `marce` le, e existe apenas nesta sessao do PowerShell: nao vai para o
# terminal, nem para log, nem para a linha de comando de processo nenhum. Ela e o preco de nao
# ter o direito de logon em lote -- registrado, nao escondido. O caminho melhor e conceder
# "Log on as a batch job" a conta, uma vez, elevado, e trocar isto por tarefa agendada, cuja
# credencial fica sob DPAPI da maquina.

param(
    [Parameter(Mandatory)][ValidateSet('preparar','executar','entregar')][string]$Acao,
    [Parameter(Mandatory)][string]$Trabalho,
    [Parameter(Mandatory)][string]$Workspace,
    [Parameter(Mandatory)][string]$Log,
    [Parameter(Mandatory)][string]$Res,
    [Parameter(Mandatory)][string]$Feito,
    [Parameter(Mandatory)][string]$Marca,
    [string]$Senha      = (Join-Path $env:USERPROFILE 'rayzenexec-senha.txt'),
    [string]$Conta      = 'RayzenExec',
    [int]   $TimeoutMin = 45
)

$ErrorActionPreference = 'Stop'

# `Write-Error` sob `-ErrorActionPreference Stop` ENCERRA o script na hora: o `exit <codigo>`
# escrito depois dele nunca roda, e o processo sai sempre com 1. Medido em 11/09, ao validar a
# recusa de canal aberto -- a guarda funcionou, o codigo declarado era ficcao. Mesma familia do
# `%PAUSA% & exit /b 1` do autostart, em que `rem` comia o `exit` da propria linha.
function Parar([string]$mensagem, [int]$codigo) {
    [Console]::Error.WriteLine($mensagem)
    exit $codigo
}

if (-not (Test-Path $Senha))    { Parar "Senha da conta nao encontrada: $Senha" 2 }
if (-not (Test-Path $Trabalho)) { Parar "Diretorio de trabalho ausente: $Trabalho" 2 }

# O runner vai para o canal publico porque a conta NAO le o repositorio do dono -- e esse e o
# desenho, nao um obstaculo. Copiado a cada lancamento: um runner velho no canal seria codigo
# que ninguem revisou rodando na conta.
$runnerFonte = Join-Path $PSScriptRoot 'sessao-isolada-runner.ps1'
if (-not (Test-Path $runnerFonte)) { Parar "Runner ausente: $runnerFonte" 2 }
$runner = Join-Path $Trabalho 'sessao-isolada-runner.ps1'
Copy-Item -LiteralPath $runnerFonte -Destination $runner -Force

# ---- CONFERIR o canal, nao reaplicar ------------------------------------------------
# Quem fecha o diretorio e o `novoTrabalho()` do agent, ANTES de escrever qualquer coisa nele
# -- a ordem importa, porque o que passa por aqui inclui um bundle de 21 MB com o repositorio
# privado inteiro. Aqui se verifica o RESULTADO, que e a regra da casa desde 09/09: toda
# mutacao termina conferindo estado, nunca codigo de saida.
#
# Comparacao por SID, nunca por nome: `BUILTIN\Usuarios` se chama outra coisa em cada idioma
# do Windows, e um script que depende do idioma passa verde na maquina errada. Mesma licao de
# `corrigir-grupo-rayzenexec.ps1`.
$abertos = @('S-1-5-32-545', 'S-1-1-0', 'S-1-5-11')   # Usuarios, Todos, Usuarios autenticados
$excesso = @()
foreach ($ace in (Get-Acl -LiteralPath $Trabalho).Access) {
    try   { $sid = $ace.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value }
    catch { $sid = $ace.IdentityReference.Value }
    if ($abertos -contains $sid) { $excesso += $sid }
}
if ($excesso.Count -gt 0) {
    Remove-Item -LiteralPath $Trabalho -Recurse -Force -ErrorAction SilentlyContinue
    Parar "O canal $Trabalho esta aberto a $($excesso -join ', '). Nada foi enviado." 2
}

$sec  = ConvertTo-SecureString (Get-Content $Senha -Raw).Trim() -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential("$env:COMPUTERNAME\$Conta", $sec)

$argumentos = @(
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', "`"$runner`"",
    '-Acao', $Acao, '-Trabalho', "`"$Trabalho`"", '-Workspace', "`"$Workspace`"",
    '-Log', "`"$Log`"", '-Res', "`"$Res`"", '-Feito', "`"$Feito`"", '-Marca', $Marca
)

try {
    Start-Process -FilePath 'powershell.exe' -ArgumentList $argumentos `
                  -Credential $cred -WorkingDirectory 'C:\RayzenExec' `
                  -WindowStyle Hidden -ErrorAction Stop
} catch {
    # NAO aborta. `Start-Process -Credential` ja lancou "Acesso negado" DEPOIS de criar o
    # processo e de ele rodar ate o fim (09/09): abortar aqui daria falso negativo com o
    # trabalho ja feito. Quem decide e a marca, abaixo.
    Write-Output "aviso-start-process=$($_.Exception.Message)"
}

# Espera pelo RESULTADO, nunca pelo mecanismo. A marca e um GUID que so este lancamento
# conhece, porque `marce` nao apaga arquivo em C:\RayzenExec: um marcador de execucao
# anterior seria lido como sucesso desta.
$limite   = (Get-Date).AddMinutes($TimeoutMin)
$concluiu = $false
while ((Get-Date) -lt $limite) {
    if ((Test-Path $Feito) -and ((Get-Content $Feito -Raw -ErrorAction SilentlyContinue).Trim() -eq $Marca)) {
        $concluiu = $true
        break
    }
    Start-Sleep -Milliseconds 500
}

# Limpa o canal: o prompt da sessao nao fica em C:\Users\Public depois do uso.
Remove-Item -LiteralPath $Trabalho -Recurse -Force -ErrorAction SilentlyContinue

if (-not $concluiu) {
    Write-Output 'concluiu=nao'
    Parar "A conta nao sinalizou conclusao em $TimeoutMin min." 1
}

Write-Output 'concluiu=sim'
if (Test-Path $Res) { Get-Content -LiteralPath $Res -Encoding utf8 }
exit 0
