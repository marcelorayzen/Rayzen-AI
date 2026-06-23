import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../../prisma/prisma.service'
import OpenAI from 'openai'
import * as puppeteer from 'puppeteer'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'

export interface GenerateDocResult {
  fileName: string
  filePath: string
  format: 'pdf' | 'docx'
  sizeBytes: number
}

const SYSTEM_PROMPT = `Você é Rayzen, um assistente especializado em geração de documentos profissionais.
Gere o conteúdo do documento em HTML bem estruturado com estilos inline para PDF.
Use formatação profissional: títulos, seções, parágrafos bem espaçados.
Responda APENAS com o HTML, sem markdown, sem explicações adicionais.
Língua: português brasileiro.`

@Injectable()
export class DocumentProcessingService {
  private llm: OpenAI
  private outputDir: string

  constructor(private readonly prisma: PrismaService, private config: ConfigService) {
    this.llm = new OpenAI({
      baseURL: this.config.get('LITELLM_BASE_URL', 'http://localhost:4000/v1'),
      apiKey: this.config.get('LITELLM_MASTER_KEY') ?? 'sk-rayzen',
    })
    this.outputDir = path.join(os.tmpdir(), 'rayzen-docs')
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true })
    }
  }

  getOutputDir(): string {
    return this.outputDir
  }

  async generatePDF(prompt: string, sessionId: string): Promise<GenerateDocResult> {
    const res = await this.llm.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Gere um documento: ${prompt}` },
      ],
      temperature: 0.2,
    })

    const html = res.choices[0].message.content ?? ''
    const tokensUsed = res.usage?.total_tokens ?? 0

    const fullHtml = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Arial', sans-serif; margin: 40px; color: #222; line-height: 1.6; }
    h1 { color: #1a1a2e; border-bottom: 2px solid #1a1a2e; padding-bottom: 8px; }
    h2 { color: #16213e; margin-top: 24px; }
    h3 { color: #0f3460; }
    p { margin: 12px 0; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    th { background: #1a1a2e; color: white; padding: 10px; text-align: left; }
    td { padding: 8px 10px; border-bottom: 1px solid #ddd; }
    tr:nth-child(even) { background: #f5f5f5; }
  </style>
</head>
<body>${html}</body>
</html>`

    const fileName = `doc_${Date.now()}.pdf`
    const filePath = path.join(this.outputDir, fileName)

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
    const page = await browser.newPage()
    await page.setContent(fullHtml, { waitUntil: 'networkidle0' })
    await page.pdf({ path: filePath, format: 'A4', margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' } })
    await browser.close()

    const sizeBytes = fs.statSync(filePath).size

    await this.prisma.conversationMessage.createMany({
      data: [
        { sessionId, module: 'doc', role: 'user', content: prompt },
        { sessionId, module: 'doc', role: 'assistant', content: `PDF gerado: ${fileName}`, tokensUsed },
      ],
    })

    return { fileName, filePath, format: 'pdf', sizeBytes }
  }

  async generateDOCX(prompt: string, data: Record<string, unknown>, sessionId: string): Promise<GenerateDocResult> {
    const res = await this.llm.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Você é Rayzen, um assistente de documentos. Gere o conteúdo do documento como texto puro,
bem estruturado com seções claramente definidas. Sem HTML, sem markdown.
Língua: português brasileiro.`,
        },
        { role: 'user', content: `Gere um documento: ${prompt}` },
      ],
      temperature: 0.2,
    })

    const content = res.choices[0].message.content ?? ''
    const tokensUsed = res.usage?.total_tokens ?? 0

    const templatePath = path.join(__dirname, 'templates', 'base.docx')
    let docxBuffer: Buffer

    if (fs.existsSync(templatePath)) {
      const templateBuffer = fs.readFileSync(templatePath)
      const zip = new PizZip(templateBuffer)
      const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true })
      doc.render({ ...data, content })
      docxBuffer = Buffer.from(doc.getZip().generate({ type: 'nodebuffer' }))
    } else {
      docxBuffer = Buffer.from(content, 'utf-8')
    }

    const fileName = `doc_${Date.now()}.docx`
    const filePath = path.join(this.outputDir, fileName)
    fs.writeFileSync(filePath, docxBuffer)

    const sizeBytes = fs.statSync(filePath).size

    await this.prisma.conversationMessage.createMany({
      data: [
        { sessionId, module: 'doc', role: 'user', content: prompt },
        { sessionId, module: 'doc', role: 'assistant', content: `DOCX gerado: ${fileName}`, tokensUsed },
      ],
    })

    return { fileName, filePath, format: 'docx', sizeBytes }
  }
}
