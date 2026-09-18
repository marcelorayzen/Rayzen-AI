# Helper FIXO de leitura de agenda. Só `days` (inteiro) chega por stdin como JSON — as datas
# do filtro são calculadas AQUI, pelo próprio PowerShell, e nunca atravessam a fronteira
# TypeScript→script como texto.
#
# A versão anterior interpolava `${today}`/`${until}` (datas formatadas em TypeScript) no
# corpo do script e no filtro Restrict() do Outlook. `toLocaleDateString('en-US')` só produz
# dígitos e barras — nunca foi explorável na prática — mas exigia confiar nisso para sempre.
# Calcular a data aqui dentro remove a pergunta por completo: não há valor externo para
# desconfiar, porque não há valor externo nenhum além de um inteiro clampado.
$ErrorActionPreference = 'Stop'
$dados = [Console]::In.ReadToEnd() | ConvertFrom-Json
$dias  = [Math]::Min([int]$dados.days, 7)

$hoje = Get-Date
$ate  = $hoje.AddDays($dias)
$hojeStr = $hoje.ToString('MM/dd/yyyy')
$ateStr  = $ate.ToString('MM/dd/yyyy')

$outlook = New-Object -ComObject Outlook.Application
$ns = $outlook.GetNamespace("MAPI")
$calendar = $ns.GetDefaultFolder(9)
$items = $calendar.Items
$items.IncludeRecurrences = $true
$items.Sort("[Start]")
# `$hojeStr`/`$ateStr` são computados por ESTE script, não recebidos — a interpolação aqui
# é segura por construção, não por sorte de formato.
$filtro = "[Start] >= '$hojeStr' AND [Start] <= '$ateStr'"
$filtrados = $items.Restrict($filtro)
$results = @()
foreach ($item in $filtrados) {
  $results += [PSCustomObject]@{
    Subject = $item.Subject
    Start = $item.Start.ToString("yyyy-MM-dd HH:mm")
    End = $item.End.ToString("yyyy-MM-dd HH:mm")
    Location = $item.Location
    Organizer = $item.Organizer
  }
}
$results | ConvertTo-Json -Compress
