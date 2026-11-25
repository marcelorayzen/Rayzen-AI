import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional, PayloadTooLargeException, ServiceUnavailableException } from '@nestjs/common'
import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type OpenAI from 'openai'
import { createLlmClient } from '../../common/llm-client'
import { PrismaService } from '../../prisma/prisma.service'
import {
  DIAS_DO_ORIGINAL, MODELOS_DE_VISAO, PROMPT_DE_VISAO, TETO_ANEXOS_POR_TURNO, TETO_BYTES, TETO_TEXTO_DOS_ANEXOS,
  detectarTipo, limitarTexto, nomeParaExibir, type AnexoDoTurno, type TipoDeAnexo,
} from './hub-anexo.const'

const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>

const DIA = 24 * 60 * 60 * 1000

/** O que a pessoa (e o turno, no HC2) vê de um anexo. O caminho no disco nunca sai daqui. */
export interface AnexoPublico {
  id: string
  nome: string
  mime: string
  tamanho: number
  extraidoPor: string
  truncado: boolean
  caracteres: number
  previa: string
  expiraEm: string | null
}

/** Extrai o texto de um arquivo já tipado. Injetável para teste; o padrão usa pdf-parse e o Gemini. */
export type Extrator = (tipo: TipoDeAnexo, buffer: Buffer) => Promise<{ texto: string; extraidoPor: string }>

/** Token do extrator alternativo (testes). Sem ele, vale o padrão. */
export const EXTRATOR_DE_ANEXO = Symbol('EXTRATOR_DE_ANEXO')

/**
 * HC1 — recebe o arquivo, confere tipo e tamanho, grava o original no volume e extrai o TEXTO que o
 * modelo vai ver. O Hermes segue só-texto (achado 1 do desenho): imagem vira descrição + transcrição
 * pelo Gemini, PDF e texto são lidos localmente, sem modelo nenhum.
 */
@Injectable()
export class HubAnexoService {
  private readonly logger = new Logger(HubAnexoService.name)
  private readonly dir = path.resolve(process.env.HUB_ANEXOS_DIR ?? path.join(process.cwd(), 'storage', 'hub-anexos'))
  private llm?: OpenAI

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(EXTRATOR_DE_ANEXO) private readonly extrator?: Extrator,
  ) {}

  async receber(entrada: { principalId: string; nome?: string; buffer: Buffer }, agora = new Date()): Promise<AnexoPublico> {
    const { principalId, buffer } = entrada
    if (buffer.length === 0) throw new BadRequestException({ code: 'hub_anexo_vazio' })
    if (buffer.length > TETO_BYTES) throw new PayloadTooLargeException({ code: 'hub_anexo_grande', tetoBytes: TETO_BYTES })
    const nome = nomeParaExibir(entrada.nome)
    const tipo = detectarTipo(buffer, nome)
    if (!tipo) throw new BadRequestException({ code: 'hub_anexo_tipo', aceitos: 'PDF, PNG, JPEG, WebP, .txt, .md, .csv, .json' })

    void this.limparExpirados(agora).catch((e: unknown) => this.logger.warn(`limpeza de anexos falhou: ${String(e)}`))

    // O mesmo arquivo da mesma pessoa não é extraído duas vezes — a descrição de imagem custa chamada.
    const sha256 = createHash('sha256').update(buffer).digest('hex')
    const existente = await this.prisma.hubAnexo.findFirst({ where: { principalId, sha256 }, orderBy: { createdAt: 'desc' } })
    if (existente) return publico(existente)

    const { texto: bruto, extraidoPor } = await (this.extrator ?? this.extrairPadrao.bind(this))(tipo, buffer)
    const { texto, truncado } = limitarTexto(bruto)

    // O nome no disco é um uuid sem extensão: nada vindo de quem enviou vira caminho.
    const id = randomUUID()
    await fs.promises.mkdir(this.dir, { recursive: true })
    const caminho = path.join(this.dir, id)
    await fs.promises.writeFile(caminho, buffer, { mode: 0o600 })

    const criado = await this.prisma.hubAnexo.create({
      data: {
        id, principalId, nome, mime: tipo.mime, tamanho: buffer.length, sha256, texto, extraidoPor, truncado,
        caminho, expiraEm: new Date(agora.getTime() + DIAS_DO_ORIGINAL * DIA),
      },
    })
    return publico(criado)
  }

  /** Só o dono vê o anexo. De outra pessoa é 404, não 403 — não confirma que o id existe. */
  async buscar(principalId: string, id: string): Promise<AnexoPublico & { texto: string }> {
    const anexo = await this.prisma.hubAnexo.findFirst({ where: { id, principalId } })
    if (!anexo) throw new NotFoundException({ code: 'hub_anexo_nao_encontrado' })
    return { ...publico(anexo), texto: anexo.texto }
  }

  /**
   * HC4b — o texto INTEIRO de um anexo, para guardar na memória. Enquanto o original existe (30
   * dias), PDF e texto são relidos do arquivo, sem o teto de 50 mil caracteres do turno — é o que
   * deixa um material de curso inteiro entrar na busca. Imagem continua sendo a descrição já feita.
   * Só o dono lê: de outra pessoa é 404, como em `buscar`.
   */
  async textoCompleto(principalId: string, id: string): Promise<{ nome: string; texto: string; completo: boolean }> {
    const anexo = await this.prisma.hubAnexo.findFirst({ where: { id, principalId } })
    if (!anexo) throw new NotFoundException({ code: 'hub_anexo_nao_encontrado' })
    const original = anexo.caminho && fs.existsSync(anexo.caminho) ? await fs.promises.readFile(anexo.caminho) : null
    if (original && anexo.mime === 'application/pdf') {
      try {
        return { nome: anexo.nome, texto: (await pdfParse(original)).text.replace(/\r\n/g, '\n').trim(), completo: true }
      } catch {
        // O texto já extraído no envio continua valendo; o resultado diz que pode estar cortado.
      }
    }
    const ehTexto = anexo.mime.startsWith('text/') || anexo.mime === 'application/json'
    if (original && ehTexto) {
      return { nome: anexo.nome, texto: original.toString('utf-8').replace(/\r\n/g, '\n').trim(), completo: true }
    }
    return { nome: anexo.nome, texto: anexo.texto, completo: !anexo.truncado }
  }

  /**
   * HC2 — os anexos de um turno, na ordem pedida. Todos precisam ser do mesmo principal: um id de
   * outra pessoa (ou inexistente) recusa o turno inteiro com 404, sem dizer qual. Limites de
   * quantidade e de texto total conferidos aqui, antes de qualquer chamada ao modelo.
   */
  async paraOTurno(principalId: string, ids: string[]): Promise<AnexoDoTurno[]> {
    const unicos = [...new Set(ids.map((i) => String(i).trim()).filter(Boolean))]
    if (unicos.length > TETO_ANEXOS_POR_TURNO) {
      throw new BadRequestException({ code: 'hub_anexos_demais', teto: TETO_ANEXOS_POR_TURNO })
    }
    const achados = await this.prisma.hubAnexo.findMany({ where: { id: { in: unicos }, principalId } })
    if (achados.length !== unicos.length) throw new NotFoundException({ code: 'hub_anexo_nao_encontrado' })
    const porId = new Map(achados.map((a) => [a.id, a]))
    const lista = unicos.map((id) => porId.get(id)!)
    const total = lista.reduce((s, a) => s + a.texto.length, 0)
    if (total > TETO_TEXTO_DOS_ANEXOS) {
      throw new BadRequestException({ code: 'hub_anexos_grandes', tetoCaracteres: TETO_TEXTO_DOS_ANEXOS })
    }
    return lista.map((a) => ({ id: a.id, nome: a.nome, mime: a.mime, texto: a.texto, truncado: a.truncado }))
  }

  /**
   * Decisão 2: apaga o ORIGINAL dos anexos vencidos e mantém o texto. Preguiçosa, a cada envio —
   * sem ciclo próprio para não criar mais um `setInterval` sem batimento.
   */
  async limparExpirados(agora = new Date()): Promise<number> {
    const vencidos = await this.prisma.hubAnexo.findMany({
      where: { expiraEm: { lt: agora }, caminho: { not: null } },
      select: { id: true, caminho: true },
      take: 50,
    })
    for (const v of vencidos) {
      if (v.caminho) await fs.promises.rm(v.caminho, { force: true })
      await this.prisma.hubAnexo.update({ where: { id: v.id }, data: { caminho: null } })
    }
    return vencidos.length
  }

  private async extrairPadrao(tipo: TipoDeAnexo, buffer: Buffer): Promise<{ texto: string; extraidoPor: string }> {
    if (tipo.tipo === 'texto') return { texto: buffer.toString('utf-8'), extraidoPor: 'utf8' }
    if (tipo.tipo === 'pdf') {
      try {
        return { texto: (await pdfParse(buffer)).text, extraidoPor: 'pdf-parse' }
      } catch {
        throw new BadRequestException({ code: 'hub_anexo_pdf_ilegivel' })
      }
    }
    const { texto, modelo } = await this.descreverImagem(tipo.mime, buffer)
    return { texto, extraidoPor: `visao:${modelo}` }
  }

  private async descreverImagem(mime: string, buffer: Buffer): Promise<{ texto: string; modelo: string }> {
    this.llm ??= createLlmClient('hub-anexo-imagem', {
      apiKey: process.env.LITELLM_MASTER_KEY ?? 'sk-rayzen',
      baseURL: process.env.LITELLM_BASE_URL ?? 'http://localhost:4100/v1',
    })
    for (const modelo of MODELOS_DE_VISAO) {
      const inicio = Date.now()
      try {
        const res = await this.llm.chat.completions.create({
          model: modelo,
          temperature: 0,
          max_tokens: 2048,
          messages: [
            { role: 'system', content: PROMPT_DE_VISAO },
            { role: 'user', content: [{ type: 'image_url', image_url: { url: `data:${mime};base64,${buffer.toString('base64')}` } }] },
          ],
        })
        const texto = res.choices[0]?.message?.content
        this.logger.log(`hub-anexo-imagem ${modelo}: tokens_used=${res.usage?.total_tokens ?? 'n/d'} duration_ms=${Date.now() - inicio}`)
        if (typeof texto !== 'string' || !texto.trim()) throw new Error('resposta vazia')
        return { texto, modelo }
      } catch (e) {
        this.logger.warn(`hub-anexo-imagem ${modelo} falhou em ${Date.now() - inicio} ms: ${String(e).slice(0, 200)}`)
      }
    }
    // 503, não 502: o Cloudflare troca o 502 da origem pela página dele, sem CORS, e o celular
    // dizia "sem conexão com o servidor" em vez de "não consegui ler a imagem" (23/11).
    throw new ServiceUnavailableException({ code: 'hub_anexo_visao_indisponivel' })
  }
}

function publico(a: {
  id: string; nome: string; mime: string; tamanho: number; extraidoPor: string; truncado: boolean
  texto: string; expiraEm: Date | null
}): AnexoPublico {
  return {
    id: a.id, nome: a.nome, mime: a.mime, tamanho: a.tamanho, extraidoPor: a.extraidoPor, truncado: a.truncado,
    caracteres: a.texto.length, previa: a.texto.slice(0, 500), expiraEm: a.expiraEm?.toISOString() ?? null,
  }
}
