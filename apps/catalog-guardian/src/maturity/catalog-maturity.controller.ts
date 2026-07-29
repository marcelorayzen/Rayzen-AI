import { Controller, Get, Res } from '@nestjs/common'
import { FastifyReply } from 'fastify'
import { CatalogMaturityService, MaturityReport } from './catalog-maturity.service'

@Controller('maturity')
export class CatalogMaturityController {
  constructor(private readonly maturity: CatalogMaturityService) {}

  @Get('report')
  report() {
    return this.maturity.computeReport()
  }

  // HTML server-side simples, sem lib/framework novo — o "PDF" do blueprint
  // vem do usuário apertando Imprimir → Salvar como PDF no navegador. Evita
  // trazer Puppeteer/Chromium pro deploy do cliente só por causa deste artefato.
  @Get('report.html')
  async reportHtml(@Res() reply: FastifyReply) {
    const report = await this.maturity.computeReport()
    reply.header('Content-Type', 'text/html; charset=utf-8')
    reply.send(renderHtml(report))
  }
}

function renderHtml(report: MaturityReport): string {
  const rows = report.dimensions
    .map(
      (d) => `
        <tr>
          <td>${d.label}${d.insufficientData ? ' <span class="warn">⚠ amostra insuficiente</span>' : ''}</td>
          <td class="score">${d.score}</td>
          <td class="evidence"><pre>${JSON.stringify(d.evidence, null, 2)}</pre></td>
        </tr>`,
    )
    .join('')

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Relatório de Maturidade — Catalog Guardian</title>
<style>
  body { font-family: Arial, sans-serif; margin: 2rem; color: #1a1a1a; }
  h1 { font-size: 1.4rem; }
  .overall { display: flex; align-items: baseline; gap: 1rem; margin: 1rem 0 2rem; }
  .overall .value { font-size: 3rem; font-weight: bold; }
  .overall .band { font-size: 1.1rem; text-transform: uppercase; color: #444; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ccc; padding: 0.5rem 0.75rem; text-align: left; vertical-align: top; }
  th { background: #f2f2f2; }
  .score { font-weight: bold; width: 4rem; }
  .evidence pre { margin: 0; font-size: 0.8rem; white-space: pre-wrap; }
  .disclaimer { margin-top: 2rem; font-size: 0.85rem; color: #555; border-top: 1px solid #ccc; padding-top: 1rem; }
  .warn { font-size: 0.8rem; color: #a15c00; font-weight: normal; }
  @media print { body { margin: 0.5rem; } }
</style>
</head>
<body>
  <h1>Relatório de Maturidade de Catálogo</h1>
  <p>Gerado em ${new Date(report.generatedAt).toLocaleString('pt-BR')}</p>
  <div class="overall">
    <span class="value">${report.overallScore}</span>
    <span class="band">${report.band}</span>
  </div>
  <table>
    <thead><tr><th>Dimensão</th><th>Score</th><th>Evidência</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="disclaimer">${report.disclaimer}</p>
</body>
</html>`
}
