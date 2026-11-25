import { BadRequestException, Injectable, Inject, forwardRef } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { NotionService } from '../notion/notion.service'
import { DOMINIOS, ehDominioValido } from '../../common/dominio-do-projeto.const'
import { STATUS_DE_PROJETO, ehStatusValido } from '../../common/status-do-projeto.const'
import { ehCaminhoDeCheckoutValido } from '../../common/checkout-do-projeto.const'

// Normaliza slug/nome para comparação tolerante:
// lowercase, _ → -, remove sufixos de visibilidade, remove não-alfanuméricos
// "rayzen-ai-private" → "rayzen-ai" ; "Rayzen AI" → "rayzen-ai" ; "vb_ferragens" → "vb-ferragens"
export function normalizeSlug(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-(private|public|fork|main|master)$/g, '')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

@Injectable()
export class ProjectService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => NotionService)) private readonly notion: NotionService,
  ) {}

  async findAll(repoSlug?: string) {
    if (repoSlug) {
      // 1. Match exato (rápido, usa índice)
      const exact = await this.prisma.project.findMany({
        where: { repoSlug },
        orderBy: { createdAt: 'desc' },
      })
      if (exact.length > 0) return exact

      // 2. Match normalizado — tolera repo privado/público, case, _ vs -
      //    ex: remote "rayzen-ai-private" resolve para repoSlug "Rayzen-AI"
      const target = normalizeSlug(repoSlug)
      const all = await this.prisma.project.findMany({ orderBy: { createdAt: 'desc' } })
      const matches = all.filter((p) => {
        if (!p.repoSlug) return false
        return normalizeSlug(p.repoSlug) === target
      })
      if (matches.length > 0) return matches

      // 3. Fallback por nome normalizado (ex: slug "rayzen-ai" ≈ nome "Rayzen AI")
      const byName = all.filter((p) => normalizeSlug(p.name) === target)
      return byName
    }
    return this.prisma.project.findMany({ orderBy: { createdAt: 'desc' } })
  }

  async findOne(id: string) {
    return this.prisma.project.findUniqueOrThrow({ where: { id } })
  }

  async create(data: { name: string; description?: string; goals?: string; repoSlug?: string; checkoutPath?: string }) {
    if (data.checkoutPath !== undefined && !ehCaminhoDeCheckoutValido(data.checkoutPath)) {
      throw new BadRequestException(
        `checkoutPath inválido: "${data.checkoutPath}". Use caminho absoluto.`,
      )
    }
    // Auto-deriva repoSlug do nome se não fornecido (ex: "Rayzen AI" → "rayzen-ai")
    const repoSlug = data.repoSlug ?? data.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    const project = await this.prisma.project.create({ data: { ...data, repoSlug } })

    this.notion.createProjectPage(project.name)
      .then(({ id }) => this.prisma.project.update({ where: { id: project.id }, data: { notionPageId: id } }))
      .catch(() => null)

    return project
  }

  /**
   * `domain` é validado contra a lista, e recusado em vez de ignorado.
   *
   * `rotuloDeDominio` trata valor desconhecido como **não classificado** — o que é a degradação
   * certa na LEITURA, e seria um defeito silencioso na ESCRITA: quem classificasse um projeto como
   * `"clientes"` (plural) teria a marca aceita pelo banco e nunca exibida, sem nada acusar. Mesma
   * família do `hipotese_com_tasktype_valido`, que nasceu de um valor cru gravado sem checagem.
   *
   * `null` explícito é permitido: desclassificar é uma operação legítima.
   *
   * ── `status` segue a mesma disciplina, e pelo mesmo motivo ─────────────────
   *
   * Ele é o ciclo de vida definido por uma PESSOA (`active` · `paused` · `done`) — ver
   * `status-do-projeto.const.ts`. Aceitar valor livre aqui repetiria o defeito que a validação do
   * `domain` existe para evitar: `"pausado"` entraria no banco, os ciclos deixariam de varrer o
   * projeto porque não é `active`, e nada acusaria — o efeito colateral certo pelo motivo errado.
   *
   * `geral` é recusado de propósito: é escopo, não ciclo de vida. Ele pertence a um projeto só, e
   * esse já existe.
   */
  async update(id: string, data: { name?: string; description?: string; goals?: string; status?: string; notionPageId?: string; repoSlug?: string; domain?: string | null; checkoutPath?: string | null }) {
    // Mesma disciplina do `domain` e do `status`: valor invalido e recusado, nao ignorado.
    // Caminho relativo aceito em silencio viraria um vinculo que so resolve junto com um `cwd`
    // que ninguem gravou — pior que nulo, porque parece resposta.
    if (data.checkoutPath !== undefined && data.checkoutPath !== null && !ehCaminhoDeCheckoutValido(data.checkoutPath)) {
      throw new BadRequestException(
        `checkoutPath inválido: "${data.checkoutPath}". Use caminho absoluto — ou null para esquecer onde está.`,
      )
    }
    if (data.domain !== undefined && data.domain !== null && !ehDominioValido(data.domain)) {
      throw new BadRequestException(
        `domain inválido: "${data.domain}". Use um de: ${DOMINIOS.join(', ')} — ou null para desclassificar.`,
      )
    }
    if (data.status !== undefined && !ehStatusValido(data.status)) {
      throw new BadRequestException(
        `status inválido: "${data.status}". Use um de: ${STATUS_DE_PROJETO.join(', ')}.`,
      )
    }
    return this.prisma.project.update({ where: { id }, data })
  }

  async delete(id: string) {
    await this.prisma.project.delete({ where: { id } })
    return { deleted: true }
  }
}
