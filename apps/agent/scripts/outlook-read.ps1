# Helper FIXO de leitura de e-mail. `limit` chega por stdin como JSON -- nunca interpolado
# num comando.
#
# A versao anterior interpolava `${limit}` direto no corpo do script gerado por template
# string (um numero clampado, entao nao era o vetor de ataque) -- mas o padrao de gerar
# script PowerShell por template e o mesmo que expos a injecao real em `outlook-send.ps1`
# (ver o comentario la). Migrado para o mesmo canal de dados dos outros helpers, por
# consistencia: um arquivo que monta comando por template e um arquivo que um dia ganha
# mais um campo interpolado sem ninguem perceber.
$ErrorActionPreference = 'Stop'
$dados = [Console]::In.ReadToEnd() | ConvertFrom-Json
$limite = [Math]::Min([int]$dados.limit, 20)

try {
  $outlook = New-Object -ComObject Outlook.Application
} catch {
  Write-Error "OUTLOOK_NOT_RUNNING: $_"
  exit 1
}
$ns = $outlook.GetNamespace("MAPI")
$folder = $ns.GetDefaultFolder(6)
$items = $folder.Items
$items.Sort("[ReceivedTime]", $true)
$count = 0
$results = @()
foreach ($item in $items) {
  if ($count -ge $limite) { break }
  $preview = ""
  try { $preview = $item.Body.Substring(0, [Math]::Min(150, $item.Body.Length)).Trim() } catch {}
  $results += [PSCustomObject]@{
    Subject    = $item.Subject
    From       = $item.SenderName
    ReceivedAt = $item.ReceivedTime.ToString("yyyy-MM-dd HH:mm")
    Preview    = $preview
    Unread     = $item.UnRead
  }
  $count++
}
if ($results.Count -eq 0) {
  Write-Output "[]"
} else {
  $results | ConvertTo-Json -Compress
}
