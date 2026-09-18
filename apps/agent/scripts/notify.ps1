# Helper FIXO de notificacao. Titulo e mensagem chegam por stdin como JSON — nunca
# interpolados num comando.
#
# O sanitizador anterior so trocava aspas duplas por simples, e `$(...)` sobrevivia para
# dentro de uma string de aspas duplas do PowerShell, onde e subexpressao.
#
# ConvertFrom-Json trata o conteudo como DADO. `InnerText` de um XmlDocument tambem — ele
# escapa o que precisa ser escapado, o que a concatenacao de string nao fazia.
$ErrorActionPreference = 'Stop'
$dados = [Console]::In.ReadToEnd() | ConvertFrom-Json
$titulo   = [string]$dados.titulo
$mensagem = [string]$dados.mensagem

[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$template.SelectSingleNode('//text[@id=1]').InnerText = $titulo
$template.SelectSingleNode('//text[@id=2]').InnerText = $mensagem
$toast = [Windows.UI.Notifications.ToastNotification]::new($template)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Rayzen AI").Show($toast)
