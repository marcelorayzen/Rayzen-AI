# Helper FIXO de clipboard. NAO recebe o texto como argumento — le de stdin.
#
# A versao anterior montava o comando por template:
#   powershell -Command "Set-Clipboard -Value '$text'"
# e o payload  x'; Write-Output PWNED; '  fechava a aspa e emendava um statement.
# Provado em 2026-09-07 montando a string, sem executar.
#
# Aqui nao ha o que escapar porque nao ha string de comando: o texto chega pelo canal de
# DADOS. `$input` e o pipeline do PowerShell; `-Raw` preserva o conteudo como veio.
$ErrorActionPreference = 'Stop'
$texto = [Console]::In.ReadToEnd()
Set-Clipboard -Value $texto
