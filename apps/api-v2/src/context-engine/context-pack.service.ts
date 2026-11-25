import {
  BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException,
} from '@nestjs/common'
import { createHash, randomUUID } from 'crypto'
import { Prisma } from '../../generated/prisma-client-v2'
import { PrismaV2Service } from '../core/prisma-v2.service'
import { KnowledgeRevisionService } from '../core/knowledge-revision.service'
import { ehDonoDoConhecimento } from '../core/knowledge-owner.const'
import { conhecimentoVigente, motivoDeNaoVigencia } from '../core/knowledge-validity.const'
import type { AuthPrincipal } from '../core/auth.guard'
import { ContextEngineService, ContextSection, WorkMode } from './context-engine.service'
import { IssueContextPackDto, ContextPackScope } from './dto/context-pack.dto'

/**
 * Versão do formato do manifesto.
 *
 * Ela entra no hash de propósito: dois pacotes com o mesmo conteúdo e formatos diferentes
 * são coisas diferentes para quem for reconstruir. Mudar o formato sem mudar este número
 * faria um pacote antigo parecer adulterado na verificação.
 */
export const CONTEXT_PACK_SCHEMA_VERSION = 'context-pack/1'

const LIMITE_PADRAO_DE_ITENS = 20
const LIMITE_PADRAO_DE_CHARS = 12_000
const AUTORIZACAO_PADRAO_MIN = 30

/**
 * Como o pacote seleciona conhecimento: por ESCOPO, não por similaridade.
 *
 * Busca vetorial não é reproduzível — o mesmo pedido devolve outra coisa quando o índice
 * muda, e um pacote que não reproduz não é evidência de nada. O que é governado entra
 * inteiro (dentro dos limites declarados), em ordem determinística.
 *
 * O que a busca traz continua existindo, e continua ao lado: as seções voláteis abaixo
 * carregam `memory_relevant` quando o modo pede. A diferença é que elas se declaram
 * `snapshot` — reproduzíveis a partir do pacote, nunca a partir da fonte.
 */
const SELETOR_DE_CONHECIMENTO = 'canonical-scope'

export type ItemLifecycle = 'approved' | 'candidate' | 'snapshot' | 'unavailable'

export interface ItemDoManifesto {
  position: number
  kind: 'knowledge' | 'context_section'
  itemKey: string
  itemRef: string | null
  lifecycle: ItemLifecycle
  version: number
  contentHash: string
  chars: number
  reproducible: boolean
}

@Injectable()
export class ContextPackService {
  private readonly logger = new Logger(ContextPackService.name)

  constructor(
    private readonly prisma: PrismaV2Service,
    private readonly context: ContextEngineService,
    private readonly revisions: KnowledgeRevisionService,
  ) {}

  async issue(dto: IssueContextPackDto, principal: AuthPrincipal) {
    const scopeKey = this.scopeKey(dto.scopeType, dto.projectId)
    const incluirCandidatos = dto.includeCandidates === true

    // Candidato não é fato, e quem decide o que vira fato é uma pessoa. Deixar um
    // consumidor de serviço pedir candidatos seria contornar a aprovação pelo caminho da
    // leitura: o conteúdo chegaria ao prompt do mesmo jeito, sem decisão nenhuma.
    if (incluirCandidatos && !ehDonoDoConhecimento(principal)) {
      throw new ForbiddenException('Only the authenticated knowledge owner can read candidates')
    }

    const limites = {
      maxItems: dto.maxItems ?? LIMITE_PADRAO_DE_ITENS,
      maxChars: dto.maxChars ?? LIMITE_PADRAO_DE_CHARS,
    }
    const agora = new Date()
    const expiraEm = new Date(
      agora.getTime() + (dto.authorizationMinutes ?? AUTORIZACAO_PADRAO_MIN) * 60_000,
    )

    const { itens, blocos, consideradosConhecimento, secoesFalhas } =
      await this.selecionar(dto, scopeKey, limites, agora, incluirCandidatos)

    const snapshot = this.montarTexto(blocos, secoesFalhas, incluirCandidatos)
    // O id é cunhado aqui, antes de gravar, porque ele faz parte do manifesto assinado.
    // Deixá-lo para o banco tiraria a identidade do pacote de dentro do próprio hash — e
    // aí duas evidências distintas poderiam carregar a mesma assinatura.
    const id = randomUUID()
    const manifesto = {
      id,
      schemaVersion: CONTEXT_PACK_SCHEMA_VERSION,
      scopeKey,
      scopeType: dto.scopeType,
      projectId: dto.projectId ?? null,
      principalKind: principal.kind,
      principalSubject: principal.subject,
      consumer: dto.consumer,
      sessionId: dto.sessionId,
      purpose: dto.purpose,
      classes: dto.classes ?? null,
      limits: {
        ...limites,
        knowledgeConsidered: consideradosConhecimento,
        itemsServed: itens.length,
        charsServed: snapshot.length,
      },
      retrievalPolicy: {
        selector: SELETOR_DE_CONHECIMENTO,
        mode: dto.mode ?? null,
        query: dto.query ?? null,
        sections: dto.sections ?? null,
        includeCandidates: incluirCandidatos,
      },
      knowledgeRevision: this.revisions.current(scopeKey),
      generatedAt: agora.toISOString(),
      authorizationExpiresAt: expiraEm.toISOString(),
      items: itens,
      snapshotHash: sha256(snapshot),
    }

    const pack = await this.prisma.contextPack.create({
      data: {
        id,
        schemaVersion: manifesto.schemaVersion,
        scopeKey,
        scopeType: dto.scopeType,
        projectId: dto.projectId,
        principalKind: principal.kind,
        principalSubject: principal.subject,
        consumer: dto.consumer,
        sessionId: dto.sessionId,
        purpose: dto.purpose,
        classes: (manifesto.classes ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        limits: manifesto.limits as Prisma.InputJsonValue,
        retrievalPolicy: manifesto.retrievalPolicy as Prisma.InputJsonValue,
        manifestHash: hashDoManifesto(manifesto),
        snapshot,
        snapshotHash: manifesto.snapshotHash,
        knowledgeRevision: manifesto.knowledgeRevision,
        generatedAt: agora,
        authorizationExpiresAt: expiraEm,
        items: { create: itens.map((item) => ({ ...item })) },
      },
      include: { items: { orderBy: { position: 'asc' } } },
    })

    return { ...this.manifestoDoRegistro(pack), text: snapshot }
  }

  /**
   * A evidência sobrevive à autorização.
   *
   * Um pacote expirado continua legível como manifesto — quem auditar precisa responder
   * "o que foi servido naquele turno?", e essa pergunta não expira. O que expira é o
   * direito de LER o conteúdo de novo, e essa separação é o `content()` abaixo.
   */
  async get(id: string) {
    const pack = await this.prisma.contextPack.findUnique({
      where: { id },
      include: { items: { orderBy: { position: 'asc' } } },
    })
    if (!pack) throw new NotFoundException('Context pack not found')
    return this.manifestoDoRegistro(pack)
  }

  async content(id: string, principal: AuthPrincipal) {
    const pack = await this.prisma.contextPack.findUnique({ where: { id } })
    if (!pack) throw new NotFoundException('Context pack not found')

    // Autorização é do principal para quem o pacote foi emitido. O dono lê qualquer um,
    // porque auditar é justamente ler o que outro recebeu.
    if (pack.principalSubject !== principal.subject && !ehDonoDoConhecimento(principal)) {
      throw new ForbiddenException('Context pack was issued to another principal')
    }
    if (pack.authorizationExpiresAt.getTime() <= Date.now()) {
      throw new ForbiddenException('Context pack authorization expired; issue a new pack')
    }

    return { id: pack.id, text: pack.snapshot, snapshotHash: pack.snapshotHash }
  }

  /**
   * Duas perguntas diferentes, e confundi-las é o erro que esta rota evita.
   *
   * **Reproduzível**: a versão exata que foi servida ainda existe com o mesmo hash — dá
   * para reconstruir o que o consumidor leu. **Vigente**: aquilo ainda seria servido hoje.
   *
   * Um item superseado depois do pacote continua reproduzível: o pacote não mentiu, o
   * mundo andou. Chamar isso de "não reproduz" apagaria a diferença entre conhecimento
   * que evoluiu e registro adulterado, que é a única coisa que a verificação existe para
   * distinguir.
   */
  async verify(id: string) {
    const pack = await this.prisma.contextPack.findUnique({
      where: { id },
      include: { items: { orderBy: { position: 'asc' } } },
    })
    if (!pack) throw new NotFoundException('Context pack not found')

    const manifesto = this.manifestoDoRegistro(pack)
    const manifestIntact = hashDoManifesto(manifesto) === pack.manifestHash
    const snapshotIntact = sha256(pack.snapshot) === pack.snapshotHash

    const referencias = pack.items
      .filter((item) => item.kind === 'knowledge' && item.itemRef)
      .map((item) => item.itemRef as string)
    const versoes = referencias.length
      ? await this.prisma.knowledgeVersion.findMany({ where: { id: { in: referencias } } })
      : []
    const porId = new Map(versoes.map((v) => [v.id, v]))
    const agora = new Date()

    const items = pack.items.map((item) => {
      if (item.kind !== 'knowledge') {
        return {
          position: item.position, itemKey: item.itemKey, kind: item.kind,
          // Seção volátil não se reconstrói a partir da fonte — a fonte já mudou por
          // definição. Dizer "reproduzível" aqui seria prometer o que não se cumpre.
          state: item.lifecycle === 'unavailable' ? 'unavailable' : 'snapshot_only',
          reproducible: false, currentlyValid: null as string | null,
        }
      }
      const versao = item.itemRef ? porId.get(item.itemRef) : undefined
      if (!versao) {
        return {
          position: item.position, itemKey: item.itemKey, kind: item.kind,
          state: 'missing', reproducible: false, currentlyValid: null,
        }
      }
      const reproducible = versao.contentHash === item.contentHash && versao.version === item.version
      return {
        position: item.position, itemKey: item.itemKey, kind: item.kind,
        state: reproducible ? 'reproducible' : 'content_changed',
        reproducible,
        currentlyValid: motivoDeNaoVigencia(versao, agora),
      }
    })

    const conhecimento = items.filter((i) => i.kind === 'knowledge')
    return {
      id: pack.id,
      manifestIntact,
      snapshotIntact,
      // Um pacote sem item de conhecimento nenhum não é "reproduzível" por vacuidade —
      // ele é só um snapshot, e dizer o contrário daria garantia onde não há nenhuma.
      reproducible: manifestIntact && snapshotIntact
        && conhecimento.length > 0 && conhecimento.every((i) => i.reproducible),
      knowledgeRevisionAtIssue: pack.knowledgeRevision,
      knowledgeRevisionNow: this.revisions.current(pack.scopeKey),
      authorizationExpired: pack.authorizationExpiresAt.getTime() <= Date.now(),
      items,
    }
  }

  list(query: { scopeType?: ContextPackScope; projectId?: string; consumer?: string; sessionId?: string }) {
    const scopeKey = query.scopeType ? this.scopeKey(query.scopeType, query.projectId) : undefined
    return this.prisma.contextPack.findMany({
      where: {
        ...(scopeKey ? { scopeKey } : {}),
        ...(query.consumer ? { consumer: query.consumer } : {}),
        ...(query.sessionId ? { sessionId: query.sessionId } : {}),
      },
      orderBy: { generatedAt: 'desc' },
      take: 100,
      include: { items: { orderBy: { position: 'asc' } } },
    })
  }

  private async selecionar(
    dto: IssueContextPackDto,
    scopeKey: string,
    limites: { maxItems: number; maxChars: number },
    agora: Date,
    incluirCandidatos: boolean,
  ) {
    const itens: ItemDoManifesto[] = []
    const blocos: Array<{ titulo: string; texto: string }> = []
    let chars = 0
    let position = 0

    const cabe = (texto: string) => chars + texto.length <= limites.maxChars
      && itens.length < limites.maxItems

    // ── Conhecimento canônico ────────────────────────────────────────────────
    // Ordem por `logicalKey` e não por data: o pacote precisa ser o mesmo quando nada
    // mudou, e data de aprovação empata com facilidade num lote aprovado de uma vez.
    const ativos = await this.prisma.knowledgeVersion.findMany({
      where: {
        scopeKey,
        status: 'active',
        ...(dto.classes?.length ? { knowledgeType: { in: dto.classes } } : {}),
      },
      orderBy: [{ logicalKey: 'asc' }],
    })
    const vigentes = ativos.filter((k) => conhecimentoVigente(k, agora))

    const aprovados: string[] = []
    for (const k of vigentes) {
      const linha = `[approved v${k.version} · ${k.logicalKey} · ${k.knowledgeType}] ${k.content}`
      // Item que não cabe é excluído INTEIRO. Cortar no meio serviria meia decisão com a
      // mesma cara de uma decisão completa, e o hash do item deixaria de corresponder à
      // versão canônica — o pacote pareceria adulterado na verificação seguinte.
      if (!cabe(linha)) break
      chars += linha.length
      aprovados.push(linha)
      itens.push({
        position: position++, kind: 'knowledge', itemKey: k.logicalKey, itemRef: k.id,
        lifecycle: 'approved', version: k.version, contentHash: k.contentHash,
        chars: linha.length, reproducible: true,
      })
    }
    if (aprovados.length) blocos.push({ titulo: 'Conhecimento aprovado', texto: aprovados.join('\n\n') })

    let candidatos: string[] = []
    if (incluirCandidatos) {
      const pendentes = await this.prisma.knowledgeProposal.findMany({
        where: {
          scopeKey, status: 'candidate',
          ...(dto.classes?.length ? { knowledgeType: { in: dto.classes } } : {}),
        },
        orderBy: [{ logicalKey: 'asc' }, { version: 'asc' }],
      })
      candidatos = []
      for (const p of pendentes) {
        const linha = `[candidate v${p.version} · ${p.logicalKey} · ${p.knowledgeType}] ${p.content}`
        if (!cabe(linha)) break
        chars += linha.length
        candidatos.push(linha)
        itens.push({
          position: position++, kind: 'knowledge', itemKey: p.logicalKey, itemRef: null,
          lifecycle: 'candidate', version: p.version, contentHash: p.contentHash,
          chars: linha.length, reproducible: false,
        })
      }
      if (candidatos.length) {
        blocos.push({ titulo: 'Candidatos — NÃO aprovados', texto: candidatos.join('\n\n') })
      }
    }

    // ── Seções voláteis ──────────────────────────────────────────────────────
    const secoesFalhas: ContextSection[] = []
    if (dto.scopeType === 'project' && dto.projectId) {
      try {
        const construido = await this.context.build({
          projectId: dto.projectId,
          mode: dto.mode as WorkMode | undefined,
          query: dto.query,
          include: dto.sections,
          maxTokens: Math.ceil(limites.maxChars / 4),
        })
        secoesFalhas.push(...construido.falhas)
        for (const [secao, texto] of Object.entries(construido.sections)) {
          if (!texto) continue
          if (!cabe(texto)) break
          chars += texto.length
          blocos.push({ titulo: rotulo(secao), texto })
          itens.push({
            position: position++, kind: 'context_section', itemKey: secao, itemRef: null,
            lifecycle: 'snapshot', version: 1, contentHash: sha256(texto),
            chars: texto.length, reproducible: false,
          })
        }
      } catch (e) {
        // O pacote não morre porque a V1 tossiu: ele registra que a leitura volátil não
        // aconteceu. Um pacote só com conhecimento governado ainda é uma leitura válida;
        // um pacote que finge ter lido o estado do projeto, não.
        this.logger.warn(`Volatile sections failed for ${dto.projectId}: ${e}`)
        secoesFalhas.push('project_state')
      }
    }

    for (const secao of secoesFalhas) {
      itens.push({
        position: position++, kind: 'context_section', itemKey: secao, itemRef: null,
        lifecycle: 'unavailable', version: 0, contentHash: sha256(''), chars: 0,
        reproducible: false,
      })
    }

    return { itens, blocos, consideradosConhecimento: vigentes.length, secoesFalhas }
  }

  private montarTexto(
    blocos: Array<{ titulo: string; texto: string }>,
    falhas: ContextSection[],
    incluirCandidatos: boolean,
  ): string {
    const partes = blocos.map((b) => `### ${b.titulo}\n${b.texto}`)
    if (incluirCandidatos) {
      partes.unshift(
        '### Aviso\nEste pacote inclui CANDIDATOS a pedido do dono. Candidato não é fato: '
        + 'relate-o como proposta não aprovada, nunca como conhecimento do projeto.',
      )
    }
    if (falhas.length) {
      partes.push(
        `### Aviso\n${falhas.join(', ')} — indisponível nesta leitura por falha ao montar, `
        + '**não** por ausência de dado. Trate como desconhecido, não como vazio.',
      )
    }
    return partes.join('\n\n')
  }

  /** O manifesto lido do registro é o mesmo objeto que gerou o hash — senão a verificação testaria outra coisa. */
  private manifestoDoRegistro(pack: RegistroDePacote) {
    return {
      id: pack.id,
      schemaVersion: pack.schemaVersion,
      scopeKey: pack.scopeKey,
      scopeType: pack.scopeType,
      projectId: pack.projectId,
      principalKind: pack.principalKind,
      principalSubject: pack.principalSubject,
      consumer: pack.consumer,
      sessionId: pack.sessionId,
      purpose: pack.purpose,
      classes: pack.classes as unknown,
      limits: pack.limits as unknown,
      retrievalPolicy: pack.retrievalPolicy as unknown,
      knowledgeRevision: pack.knowledgeRevision,
      generatedAt: pack.generatedAt.toISOString(),
      authorizationExpiresAt: pack.authorizationExpiresAt.toISOString(),
      items: pack.items.map((item) => ({
        position: item.position, kind: item.kind, itemKey: item.itemKey, itemRef: item.itemRef,
        lifecycle: item.lifecycle, version: item.version, contentHash: item.contentHash,
        chars: item.chars, reproducible: item.reproducible,
      })),
      snapshotHash: pack.snapshotHash,
      manifestHash: pack.manifestHash,
    }
  }

  private scopeKey(scopeType: ContextPackScope, projectId?: string): string {
    if (scopeType === 'personal') {
      if (projectId) throw new BadRequestException('Personal scope cannot include projectId')
      return 'personal'
    }
    if (!projectId) throw new BadRequestException('projectId is required for project scope')
    return `project:${projectId}`
  }
}

interface RegistroDePacote {
  id: string; schemaVersion: string; scopeKey: string; scopeType: string
  projectId: string | null; principalKind: string; principalSubject: string
  consumer: string; sessionId: string; purpose: string
  classes: unknown; limits: unknown; retrievalPolicy: unknown
  knowledgeRevision: number; generatedAt: Date; authorizationExpiresAt: Date
  snapshotHash: string; manifestHash: string
  items: Array<{
    position: number; kind: string; itemKey: string; itemRef: string | null
    lifecycle: string; version: number; contentHash: string; chars: number; reproducible: boolean
  }>
}

/**
 * O hash cobre o manifesto INTEIRO menos ele mesmo.
 *
 * Excluir qualquer outro campo criaria uma janela onde o registro muda e a verificação
 * continua dizendo "íntegro" — uma finalidade reescrita, um principal trocado, um item a
 * menos passariam despercebidos. Por isso não há lista de campos aqui: o que entra é tudo
 * o que o manifesto expõe.
 */
function hashDoManifesto(manifesto: Record<string, unknown>): string {
  const { manifestHash: _ignorado, ...resto } = manifesto as { manifestHash?: string }
  return sha256(JSON.stringify(ordenar(resto)))
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function ordenar(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(ordenar)
  if (valor && typeof valor === 'object') {
    const origem = valor as Record<string, unknown>
    const destino: Record<string, unknown> = {}
    for (const chave of Object.keys(origem).sort()) destino[chave] = ordenar(origem[chave])
    return destino
  }
  return valor
}

function rotulo(secao: string): string {
  return secao.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
