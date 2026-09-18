# Helper FIXO de screenshot. `project`/`filename` chegam por stdin como JSON -- nunca
# interpolados dentro do corpo do script, como o codigo anterior fazia
# (`$dir = Join-Path $base '${project}'`). Os dois ja eram sanitizados no lado do
# TypeScript (so `[a-zA-Z0-9_-]`), entao nao era exploravel hoje -- mas "seguro porque
# sanitizado antes" e a mesma aposta que este plano existe para eliminar, e uma sanitizacao
# que muda de regra um dia vira injecao sem ninguem perceber.
#
# `Join-Path` recebe os valores como ARGUMENTO da funcao, nao como texto dentro de uma
# string que o parser reavalia -- e por isso que atribuicao/chamada direta e diferente de
# interpolar dentro de aspas duplas.
$ErrorActionPreference = 'Stop'
$dados = [Console]::In.ReadToEnd() | ConvertFrom-Json

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$base = Join-Path ([Environment]::GetFolderPath('MyPictures')) 'Rayzen'
$dir  = Join-Path $base ([string]$dados.project)
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
$out  = Join-Path $dir ([string]$dados.filename)

$b   = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
$g   = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$bmp.Save($out)
$g.Dispose()
$bmp.Dispose()
Write-Output $out
