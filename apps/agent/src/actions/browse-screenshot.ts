import open from 'open'
import { takeScreenshot } from './screenshot'
import { writeFileSync } from 'node:fs'

/**
 * Abre uma URL no browser padrão, aguarda carregamento e tira screenshot da tela.
 * Usado pelo Agent para QA visual e geração de evidências de teste.
 */
export async function browseAndScreenshot(payload: {
  url:          string
  label?:       string
  waitMs?:      number
  projectName?: string
}): Promise<{ screenshotPath: string; metaPath: string; url: string; takenAt: string }> {
  const { url, label = 'browse', waitMs = 3500, projectName } = payload

  // Abre no browser padrão (sem restrição de domínio — é ação de QA)
  await open(url)

  // Aguarda carregamento da página
  await new Promise((r) => setTimeout(r, waitMs))

  const { path: screenshotPath, takenAt } = await takeScreenshot({ projectName, label })

  // Salva metadados junto com o screenshot
  const metaPath = screenshotPath.replace(/\.png$/i, '.json')
  writeFileSync(
    metaPath,
    JSON.stringify({ url, label, takenAt, screenshotPath, projectName }, null, 2),
    'utf8',
  )

  return { screenshotPath, metaPath, url, takenAt }
}
