import { BadRequestException, Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { RotinaDisparoService, type ResultadoDoDisparo } from './rotina-disparo.service'
import { EVENTOS_DO_GITHUB, validarGatilho, type EventoDoGithub } from './rotina.const'

/** O que o `mcp-http` manda depois de conferir a assinatura (webhook-rotinas.mjs). */
export interface EventoDoGithubParaRotina {
  evento: EventoDoGithub
  repo: string
  /** Login de quem abriu o PR ou disparou o CI. */
  autor?: string
  numero?: number
  ramo?: string
  sha?: string
  workflow?: string
  url?: string
}

const REPO = /^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/
const ESTRUTURAL = /^[A-Za-z0-9._\-/#:]{1,200}$/
const RAMO = /^[A-Za-z0-9._/-]{1,200}$/

/**
 * Decisão 4 do desenho (21/11): na v1, gatilho do GitHub só de repositório do próprio Marcelo. A
 * lista é configurável para não exigir deploy ao incluir uma organização dele.
 */
function donosPermitidos(): string[] {
  return (process.env.ROTINAS_GITHUB_DONOS ?? 'marcelorayzen').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean)
}

/**
 * G6, fatia 6 — um evento do GitHub, já com a assinatura conferida pelo `mcp-http`, vira disparos
 * das rotinas que casam. A api REVALIDA a forma de cada campo: confiar no `.mjs` seria confiar que
 * nenhum outro chamador com `AGENT_TOKEN` existe.
 */
@Injectable()
export class RotinaGatilhoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly disparo: RotinaDisparoService,
  ) {}

  async receber(ev: EventoDoGithubParaRotina): Promise<{ projeto: string | null; disparos: Array<{ rotinaId: string } & ResultadoDoDisparo> }> {
    const problemas = this.validar(ev)
    if (problemas.length) throw new BadRequestException(`evento recusado: ${problemas.join('; ')}`)

    const [, dono, nome] = REPO.exec(ev.repo) ?? []
    if (!donosPermitidos().includes(dono.toLowerCase())) {
      throw new BadRequestException(`repositório de ${dono} não pode disparar rotina (só ${donosPermitidos().join(', ')})`)
    }
    // Repositório do Marcelo não basta: num repositório público qualquer um abre PR. Quem abriu o
    // PR (ou disparou o CI) também tem de ser um dono permitido, e autor ausente não passa.
    if (!ev.autor || !donosPermitidos().includes(ev.autor.toLowerCase())) {
      throw new BadRequestException(`evento de ${ev.autor ?? 'autor ausente'} não dispara rotina (só ${donosPermitidos().join(', ')})`)
    }

    // O projeto é achado pelo `repoSlug` (nome do repositório). Sem projeto, nenhuma rotina pode
    // casar — e isso não é erro: o webhook pode estar configurado antes de a rotina existir.
    const projeto = await this.prisma.project.findFirst({
      where: { repoSlug: { equals: nome, mode: 'insensitive' } },
      select: { id: true },
    })
    if (!projeto) return { projeto: null, disparos: [] }

    const rotinas = await this.prisma.rotina.findMany({ where: { projectId: projeto.id, status: 'ativa' } })
    const casam = rotinas.filter((r) => {
      try {
        const g = validarGatilho(r.gatilho)
        return g.tipo === 'github' && g.evento === ev.evento
      } catch {
        return false
      }
    })

    const valores = {
      repo: ev.repo, 'pr.numero': ev.numero, 'pr.ramo': ev.ramo, sha: ev.sha, workflow: ev.workflow, url: ev.url,
    }
    // Identidade do evento: o GitHub reentrega webhook, e a mesma falha de CI não pode propor duas vezes.
    const chave = [ev.repo, ev.evento, ev.sha ?? '', ev.workflow ?? String(ev.numero ?? '')].join('#')

    const disparos = []
    for (const rotina of casam) {
      const r = await this.disparo.disparar(rotina.id, {
        tipo: 'github', valores, chave, ...(ev.ramo ? { baseRef: ev.ramo } : {}),
      })
      disparos.push({ rotinaId: rotina.id, ...r })
    }
    return { projeto: projeto.id, disparos }
  }

  private validar(ev: EventoDoGithubParaRotina): string[] {
    const p: string[] = []
    if (!EVENTOS_DO_GITHUB.includes(ev?.evento)) p.push('evento fora da lista')
    if (typeof ev?.repo !== 'string' || !REPO.test(ev.repo)) p.push('repo precisa ser dono/nome')
    if (ev?.numero !== undefined && !(Number.isInteger(ev.numero) && ev.numero > 0)) p.push('numero inválido')
    if (ev?.ramo !== undefined && (typeof ev.ramo !== 'string' || !RAMO.test(ev.ramo) || ev.ramo.startsWith('-') || ev.ramo.includes('..'))) {
      p.push('ramo inválido')
    }
    for (const campo of ['sha', 'workflow', 'url'] as const) {
      const v = ev?.[campo]
      // `workflow` é nome dado por quem escreveu o YAML: com espaço ou frase, fica de fora em vez de
      // recusar o evento inteiro — o marcador dele vira "[valor recusado]" no envelope.
      if (v !== undefined && (typeof v !== 'string' || (campo !== 'workflow' && !ESTRUTURAL.test(v)))) p.push(`${campo} inválido`)
    }
    return p
  }
}
