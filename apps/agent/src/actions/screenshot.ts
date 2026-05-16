import { execSync } from 'child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

export async function takeScreenshot(payload?: {
  projectName?: string
  label?: string
}): Promise<{ path: string; takenAt: string }> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')

  // Organiza por projeto: Pictures\Rayzen\{projeto}\{label}-{ts}.png
  // Sem projeto: Pictures\Rayzen\geral\{ts}.png
  const project = sanitize(payload?.projectName) ?? 'geral'
  const prefix  = sanitize(payload?.label) ?? 'screenshot'
  const filename = `${prefix}-${timestamp}.png`

  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    `$base = Join-Path ([Environment]::GetFolderPath('MyPictures')) 'Rayzen'`,
    `$dir  = Join-Path $base '${project}'`,
    'if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }',
    `$out  = Join-Path $dir '${filename}'`,
    '$b    = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
    '$bmp  = New-Object System.Drawing.Bitmap($b.Width, $b.Height)',
    '$g    = [System.Drawing.Graphics]::FromImage($bmp)',
    '$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)',
    '$bmp.Save($out)',
    '$g.Dispose()',
    '$bmp.Dispose()',
    'Write-Output $out',
  ].join('; ')

  const result = execSync(`powershell.exe -NoProfile -NonInteractive -Command "${script}"`, {
    encoding: 'utf-8',
    timeout: 20000,
  }).trim()

  return { path: result, takenAt: new Date().toISOString() }
}

function sanitize(s?: string): string | undefined {
  if (!s) return undefined
  return s.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 40)
}
