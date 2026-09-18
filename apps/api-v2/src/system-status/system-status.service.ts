import { Injectable, Logger } from '@nestjs/common'
import { PrismaV2Service } from '../core/prisma-v2.service'
import { COMPONENTES, COMPONENTE_POR_ID, type ComponenteId } from './system-components.const'

/**
 * Os quatro estados possíveis de um ciclo.
 *
 * `falhando` é o que justifica separar tentativa de sucesso: um ciclo que captura
 * o próprio erro e loga `warn` é, de qualquer tabela de resultado, idêntico a um
 * ciclo que teve sucesso quieto. É o estado que descreve um sistema que *parece*
 * funcionando — e não era visível em lugar nenhum antes disto.
 */
export type EstadoComponente = 'nunca-subiu' | 'saudavel' | 'falhando' | 'sem-noticia'

export interface StatusComponente {
  id:            ComponenteId
  titulo:        string
  onde:          'api-v2' | 'api' | 'agent'
  estado:        EstadoComponente
  lastAttemptAt: Date | null
  lastSuccessAt: Date | null
  atrasoMs:      number | null
  lastError:     string | null
  lastDetail:    unknown
  host:          string | null
  desligarCom:   string | null
}

export interface BeatInput {
  ok:      boolean
  erro?:   string
  detalhe?: Record<string, unknown>
  host?:   string
}

@Injectable()
export class SystemStatusService {
  private readonly logger = new Logger(SystemStatusService.name)

  constructor(private readonly prisma: PrismaV2Service) {}

  /**
   * Registra que o componente executou. **Chamar sempre em `finally`.**
   *
   * `lastAttemptAt` sobe em toda rodada; `lastSuccessAt` só quando `ok`. Um beat
   * que só acontece no caminho feliz deixa o ciclo que quebra toda vez
   * indistinguível do ciclo que nunca subiu — o problema original disfarçado.
   *
   * Nunca lança: contabilidade de saúde não pode derrubar o ciclo que ela observa.
   */
  async beat(component: ComponenteId, input: BeatInput): Promise<void> {
    const agora = new Date()
    try {
      await this.prisma.systemHeartbeat.upsert({
        where:  { component },
        create: {
          component,
          lastAttemptAt: agora,
          lastSuccessAt: input.ok ? agora : null,
          lastError:     input.ok ? null : (input.erro ?? 'erro sem mensagem'),
          lastDetail:    (input.detalhe ?? {}) as object,
          host:          input.host ?? 'api-v2',
        },
        update: {
          lastAttemptAt: agora,
          // Sucesso anterior é preservado quando a rodada falha — é justamente a
          // distância entre os dois campos que revela "roda e falha toda vez".
          ...(input.ok ? { lastSuccessAt: agora, lastError: null } : { lastError: input.erro ?? 'erro sem mensagem' }),
          lastDetail: (input.detalhe ?? {}) as object,
          host:       input.host ?? 'api-v2',
        },
      })
    } catch (e) {
      this.logger.warn(`beat(${component}) falhou: ${e}`)
    }
  }

  /** Estado de todos os componentes declarados, batendo ou não. */
  async status(): Promise<StatusComponente[]> {
    const linhas = await this.prisma.systemHeartbeat
      .findMany()
      .catch(() => [] as Awaited<ReturnType<PrismaV2Service['systemHeartbeat']['findMany']>>)

    const porId = new Map(linhas.map((l) => [l.component, l]))
    const agora = Date.now()

    // Itera o CATÁLOGO, não as linhas: componente que nunca bateu precisa
    // aparecer como "nunca-subiu" em vez de sumir da lista.
    return COMPONENTES.map((c) => {
      const linha = porId.get(c.id)

      if (!linha) {
        return {
          id: c.id, titulo: c.titulo, onde: c.onde, estado: 'nunca-subiu' as const,
          lastAttemptAt: null, lastSuccessAt: null, atrasoMs: null,
          lastError: null, lastDetail: null, host: null, desligarCom: c.desligarCom,
        }
      }

      const limite   = c.beatEveryMs + c.graceMs
      const atrasoMs = agora - linha.lastAttemptAt.getTime()

      const estado: EstadoComponente =
        atrasoMs > limite         ? 'sem-noticia'
        : linha.lastSuccessAt === null || linha.lastError !== null ? 'falhando'
        : 'saudavel'

      return {
        id: c.id, titulo: c.titulo, onde: c.onde, estado,
        lastAttemptAt: linha.lastAttemptAt,
        lastSuccessAt: linha.lastSuccessAt,
        atrasoMs:      atrasoMs > limite ? atrasoMs : null,
        lastError:     linha.lastError,
        lastDetail:    linha.lastDetail,
        host:          linha.host,
        desligarCom:   c.desligarCom,
      }
    })
  }

  /**
   * Só o que está errado — é isto que o hook injeta.
   *
   * Mesma regra dos invariantes: silencioso quando saudável. "4 de 4 ok" em todo
   * prompt treina a ignorar o aviso que importa.
   */
  async problemas(): Promise<StatusComponente[]> {
    return (await this.status()).filter((c) => c.estado !== 'saudavel')
  }

  /** Catálogo estático — permite listar antes do primeiro batimento. */
  catalogo() {
    return COMPONENTES
  }

  conhece(id: string): id is ComponenteId {
    return COMPONENTE_POR_ID.has(id as ComponenteId)
  }
}
