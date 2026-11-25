# Helper FIXO de envio de e-mail. `to`/`subject`/`body` chegam por stdin como JSON.
#
# ISTO SUBSTITUI UMA INJECAO REAL, nao teorica. O codigo anterior gerava o .ps1 por template
# string:
#
#   $mail.To = "${to}"
#
# `to` e endereco de destinatario, validado so com `.includes('@')` do lado do TypeScript --
# NADA impedia `to = 'x$(calc.exe)'`. Dentro de aspas DUPLAS do PowerShell, `$( )` e
# subexpressao: o script gerado continha literalmente `.To = "x$(calc.exe)"`, e o
# PowerShell executaria `calc.exe` ao simplesmente ATRIBUIR a propriedade -- antes de
# qualquer `.Send()`. `subject`/`body` usavam here-string (`@'...'@`), mais resistente, mas
# ainda quebravel por uma linha exatamente igual a `'@` no inicio (fecha o here-string cedo
# e o resto vira codigo). Achado ao migrar este arquivo para a Fase 1 do plano de execucao
# tipada, nunca tinha sido testado adversarialmente como clipboard/notify foram na Fase 1-A.
#
# A cura e a mesma dos outros dois helpers: os valores chegam por ConvertFrom-Json e sao
# ATRIBUIDOS diretamente a propriedade do objeto COM -- nunca colados dentro de uma string
# que o parser do PowerShell reinterpreta. Atribuicao direta nao reavalia o CONTEUDO do
# valor como sintaxe; string entre aspas, sim.
$ErrorActionPreference = 'Stop'
$dados = [Console]::In.ReadToEnd() | ConvertFrom-Json

$outlook = New-Object -ComObject Outlook.Application
$mail = $outlook.CreateItem(0)
$mail.To      = [string]$dados.to
$mail.Subject = [string]$dados.subject
$mail.Body    = [string]$dados.body
$mail.Send()
Write-Output "sent"
