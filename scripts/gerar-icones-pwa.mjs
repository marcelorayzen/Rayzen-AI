// Gera os ícones PNG do PWA (item 7.4) a partir de apps/web/public/rayzen-icon.svg.
//
// Uso: node scripts/gerar-icones-pwa.mjs
//
// PNG e não SVG no manifest: o Chrome do Android exige 192 e 512 em PNG para oferecer
// "instalar", e o iOS só lê apple-touch-icon em PNG. Usa o puppeteer que já é dependência do
// apps/api (está lá para PDF) — nenhuma dependência nova, como o smoke:web.
//
// `maskable` leva margem de 20% de cada lado: o Android recorta o ícone em círculo/squircle e
// a zona segura é o círculo central de 80%. Sem a margem, os nós externos seriam cortados.
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(raiz, 'apps/api/package.json'))
const puppeteer = require('puppeteer')

const FUNDO = '#0a0a0a' // --hud-bg em apps/web/app/globals.css
const svg = readFileSync(join(raiz, 'apps/web/public/rayzen-icon.svg'), 'utf8')
const PUBLIC = join(raiz, 'apps/web/public')

const alvos = [
  { arquivo: 'icon-192x192.png', lado: 192, margem: 0.08 },
  { arquivo: 'icon-512x512.png', lado: 512, margem: 0.08 },
  { arquivo: 'icon-maskable-512x512.png', lado: 512, margem: 0.2 },
  { arquivo: 'apple-touch-icon.png', lado: 180, margem: 0.1 },
]

const browser = await puppeteer.launch({ headless: true })
try {
  const page = await browser.newPage()
  for (const { arquivo, lado, margem } of alvos) {
    const interno = Math.round(lado * (1 - 2 * margem))
    await page.setViewport({ width: lado, height: lado, deviceScaleFactor: 1 })
    await page.setContent(
      `<html><body style="margin:0;width:${lado}px;height:${lado}px;background:${FUNDO};` +
        `display:flex;align-items:center;justify-content:center">` +
        `<div style="width:${interno}px;height:${interno}px">` +
        svg.replace('<svg ', `<svg width="${interno}" height="${interno}" `) +
        `</div></body></html>`,
    )
    const png = await page.screenshot({ type: 'png', omitBackground: false })
    writeFileSync(join(PUBLIC, arquivo), png)
    console.log(`${arquivo}  ${lado}x${lado}  ${png.length} bytes`)
  }
} finally {
  await browser.close()
}
