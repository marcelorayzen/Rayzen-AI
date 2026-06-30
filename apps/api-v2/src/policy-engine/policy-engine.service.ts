import { Injectable, Logger } from '@nestjs/common'
import { PrismaV2Service } from '../core/prisma-v2.service'
import { ApprovalGatesService } from '../approval-gates/approval-gates.service'

export type PolicyOperation =
  | 'knowledge_add'
  | 'knowledge_extract'
  | 'code_commit'
  | 'deployment'
  | 'memory_add'
  | 'specialist_run'

export interface PolicyContext {
  operation:  PolicyOperation
  projectId:  string
  data:       Record<string, unknown>
}

export interface PolicyViolation {
  rule:    string
  action:  'warn' | 'block' | 'gate'
  message: string
}

/** Violação coberta por uma PolicyException ativa — registrada, não bloqueia/gateia. */
export interface PolicyExemption extends PolicyViolation {
  exceptionId: string
  reason:      string
}

export interface PolicyEvalResult {
  allowed:        boolean             // false se qualquer regra tem action='block'
  violations:     PolicyViolation[]   // block violations — operation permanently denied
  warnings:       PolicyViolation[]   // warn — operation continues with warning
  gateRequired:   boolean             // true se alguma regra gate foi violada
  gateViolations: PolicyViolation[]   // gate violations — ApprovalGate criado automaticamente
  gateId?:        string              // ID do ApprovalGate criado (se gateRequired=true)
  exemptions:     PolicyExemption[]   // violações com PolicyException ativa — formalizadas, não bloqueiam
}

/** Pesos de origem — espelho do KnowledgeGovernanceService */
const ORIGIN_WEIGHT: Record<string, number> = {
  manual:    1.0,
  adr:       0.95,
  document:  0.85,
  meeting:   0.75,
  extracted: 0.70,
  inferred:  0.55,
}

type RuleTester = (ctx: PolicyContext, config: Record<string, unknown>) => { violated: boolean; message: string }

/** Implementações das regras conhecidas. Novas regras: adicionar aqui + seed na migration. */
const RULE_TESTERS: Record<string, RuleTester> = {
  memory_requires_source: (ctx, config) => {
    if (ctx.operation !== 'knowledge_add' && ctx.operation !== 'knowledge_extract') {
      return { violated: false, message: '' }
    }
    const origin  = ctx.data.origin as string | undefined
    const weight  = ORIGIN_WEIGHT[origin ?? 'inferred'] ?? 0.55
    const minW    = (config.minOriginWeight as number) ?? 0.7
    if (weight >= minW) return { violated: false, message: '' }
    return {
      violated: true,
      message:  `Nó adicionado com origin="${origin ?? 'none'}" (peso=${weight}) abaixo do mínimo exigido (${minW}). Prefira document, adr ou manual.`,
    }
  },

  low_confidence_knowledge: (ctx, config) => {
    if (ctx.operation !== 'knowledge_add') return { violated: false, message: '' }
    const trustScore  = ctx.data.trustScore as number ?? 1
    const minC        = (config.minConfidence as number) ?? 0.3
    if (trustScore >= minC) return { violated: false, message: '' }
    return {
      violated: true,
      message:  `Trust score=${trustScore.toFixed(2)} está abaixo do limiar mínimo (${minC}). Operação bloqueada para evitar conhecimento contraditório.`,
    }
  },

  code_requires_adr: (ctx) => {
    if (ctx.operation !== 'code_commit') return { violated: false, message: '' }
    const hasAdr = !!ctx.data.adrId
    if (hasAdr) return { violated: false, message: '' }
    return {
      violated: true,
      message:  'Commit de código sem ADR associada. Registre a decisão arquitetural antes de prosseguir.',
    }
  },

  deployment_requires_review: (ctx) => {
    if (ctx.operation !== 'deployment') return { violated: false, message: '' }
    const reviewed = !!ctx.data.approvalGateId
    if (reviewed) return { violated: false, message: '' }
    return {
      violated: true,
      message:  'Deploy requer aprovação humana via ApprovalGate. Abra um gate antes de prosseguir.',
    }
  },

  synthesizer_requires_sources: (ctx) => {
    if (ctx.operation !== 'specialist_run' || ctx.data.specialistType !== 'synthesizer') {
      return { violated: false, message: '' }
    }
    const hasSources = !!ctx.data.hasSources
    if (hasSources) return { violated: false, message: '' }
    return {
      violated: true,
      message:  'Specialist synthesizer foi acionado sem outputs/contexto prévio para sintetizar — risco de gerar documento sem fonte real.',
    }
  },
}

@Injectable()
export class PolicyEngineService {
  private readonly logger = new Logger(PolicyEngineService.name)

  constructor(
    private readonly prisma: PrismaV2Service,
    private readonly gates:  ApprovalGatesService,
  ) {}

  /**
   * Avalia todas as políticas ativas (sistema + projeto) contra o contexto da operação.
   * Regra de projeto com mesmo `name` que regra de sistema sobrescreve a de sistema.
   */
  async evaluate(ctx: PolicyContext): Promise<PolicyEvalResult> {
    const rawRules = await this.prisma.policyRule.findMany({
      where: {
        enabled: true,
        OR: [{ projectId: null }, { projectId: ctx.projectId }],
      },
    })

    // Override: regra de projeto vence regra de sistema com mesmo name
    const ruleMap = new Map<string, typeof rawRules[number]>()
    for (const rule of rawRules) {
      const existing = ruleMap.get(rule.name)
      if (!existing || rule.projectId !== null) {
        ruleMap.set(rule.name, rule)
      }
    }

    const violations:     PolicyViolation[] = []
    const gateViolations: PolicyViolation[] = []
    const warnings:       PolicyViolation[] = []
    const exemptions:     PolicyExemption[] = []

    for (const rule of ruleMap.values()) {
      const tester = RULE_TESTERS[rule.name]
      if (!tester) {
        this.logger.warn(`Regra "${rule.name}" sem implementação no PolicyEngine — ignorada`)
        continue
      }

      const config = (rule.config ?? {}) as Record<string, unknown>
      const { violated, message } = tester(ctx, config)
      if (!violated) continue

      const action = rule.action as 'warn' | 'block' | 'gate'
      const violation: PolicyViolation = { rule: rule.name, action, message }

      // warn nunca bloqueia nada — não há motivo para procurar exceção.
      if (action === 'warn') {
        warnings.push(violation)
        continue
      }

      const exception = await this.findActiveException(rule.id, ctx)
      if (exception) {
        exemptions.push({ ...violation, exceptionId: exception.id, reason: exception.reason })
        this.logger.log(`PolicyEngine: violação de "${rule.name}" coberta por exceção ${exception.id} (${exception.reason})`)
        continue
      }

      if (action === 'gate') {
        gateViolations.push(violation)
      } else {
        violations.push(violation)
      }
    }

    const allowed      = violations.length === 0
    const gateRequired = gateViolations.length > 0

    if (!allowed) {
      this.logger.warn(`PolicyEngine bloqueou "${ctx.operation}" em ${ctx.projectId}: ${violations.map((v) => v.rule).join(', ')}`)
    }

    // Create a real ApprovalGate for each gate violation
    let gateId: string | undefined
    if (gateRequired) {
      try {
        const description = gateViolations.map((v) => v.message).join('; ')
        const gate = await this.gates.create({
          projectId:   ctx.projectId,
          type:        'data_write',
          description: `[Policy] ${ctx.operation}: ${description.slice(0, 300)}`,
          context:     { operation: ctx.operation, rules: gateViolations.map((v) => v.rule), data: ctx.data },
          riskLevel:   'medium',
          autoOnExpiry: 'reject',
        })
        gateId = gate.id
        this.logger.log(`PolicyEngine criou ApprovalGate ${gate.id} para "${ctx.operation}" em ${ctx.projectId}`)
      } catch (e) {
        this.logger.error(`PolicyEngine falhou ao criar ApprovalGate: ${e}`)
      }
    }

    return { allowed, violations, warnings, gateRequired, gateViolations, gateId, exemptions }
  }

  /**
   * Procura uma PolicyException ativa (não revogada, não expirada) para a regra+projeto.
   * Se a exceção tem scope.missionId/stepId, só vale se ctx.data tiver o mesmo missionId/stepId
   * — exceção com escopo vazio vale para o projeto inteiro.
   */
  private async findActiveException(ruleId: string, ctx: PolicyContext) {
    const candidates = await this.prisma.policyException.findMany({
      where: {
        ruleId,
        projectId: ctx.projectId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    })

    return candidates.find((exc) => {
      const scope = (exc.scope ?? {}) as Record<string, unknown>
      if (Object.keys(scope).length === 0) return true
      if (scope.missionId && scope.missionId !== ctx.data.missionId) return false
      if (scope.stepId && scope.stepId !== ctx.data.stepId) return false
      return true
    })
  }

  // ─── CRUD de exceções ──────────────────────────────────────────────────────

  async listExceptions(projectId?: string, ruleId?: string) {
    return this.prisma.policyException.findMany({
      where: {
        ...(projectId ? { projectId } : {}),
        ...(ruleId ? { ruleId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  async createException(dto: {
    ruleId:     string
    projectId:  string
    reason:     string
    grantedBy:  string
    scope?:     Record<string, unknown>
    expiresAt?: string
  }) {
    return this.prisma.policyException.create({
      data: {
        ruleId:    dto.ruleId,
        projectId: dto.projectId,
        reason:    dto.reason,
        grantedBy: dto.grantedBy,
        scope:     (dto.scope ?? {}) as object,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    })
  }

  async revokeException(id: string) {
    return this.prisma.policyException.update({
      where: { id },
      data:  { revokedAt: new Date() },
    })
  }

  // ─── CRUD de regras ────────────────────────────────────────────────────────

  async listRules(projectId?: string) {
    return this.prisma.policyRule.findMany({
      where: { OR: [{ projectId: null }, ...(projectId ? [{ projectId }] : [])] },
      orderBy: [{ projectId: 'asc' }, { name: 'asc' }],
    })
  }

  async createRule(dto: {
    projectId?:  string
    name:        string
    description: string
    action:      'warn' | 'block' | 'gate'
    config?:     Record<string, unknown>
    enabled?:    boolean
  }) {
    return this.prisma.policyRule.create({
      data: {
        projectId:   dto.projectId ?? null,
        name:        dto.name,
        description: dto.description,
        action:      dto.action,
        config:      (dto.config ?? {}) as object,
        enabled:     dto.enabled ?? true,
      },
    })
  }

  async updateRule(id: string, patch: {
    enabled?:    boolean
    action?:     'warn' | 'block' | 'gate'
    config?:     Record<string, unknown>
    description?: string
  }) {
    return this.prisma.policyRule.update({
      where: { id },
      data: {
        ...(patch.enabled    !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.action                  ? { action: patch.action }   : {}),
        ...(patch.description             ? { description: patch.description } : {}),
        ...(patch.config                  ? { config: patch.config as object } : {}),
      },
    })
  }

  async deleteRule(id: string) {
    return this.prisma.policyRule.delete({ where: { id } })
  }
}
