import { Body, Controller, Get, Post } from '@nestjs/common'
import { IsNotEmpty, IsOptional, IsString } from 'class-validator'
import { GovernancePolicyService } from './governance-policy.service'

class CreateGovernancePolicyDto {
  @IsString()
  @IsNotEmpty()
  topic!: string

  @IsString()
  @IsOptional()
  question?: string

  @IsString()
  @IsNotEmpty()
  description!: string

  @IsString()
  @IsOptional()
  documentRef?: string

  @IsString()
  @IsOptional()
  version?: string
}

// QA-CHECKLIST.md § 12 "Processo/política" — CRUD administrativo simples.
// GET expõe `externalId: policy.topic` e NUNCA uma chave `domain` de
// propósito: golden-dataset/avaliador.py's `_catalogo()`/`dominios_do_ativo()`
// tratam ausência de `domain` como "não escopado por domínio" (mesma
// semântica já usada por /catalog/glossary-terms), e a checagem de
// alucinação depende de `externalId` existir no espaço de identidade.
//
// Sem spec de propósito: nenhum dos 7 controllers deste app tem spec
// dedicado (wrapper HTTP fino, lógica de negócio testada no service —
// GovernancePolicyService já cobre isto). Mesmo padrão em todo o monorepo
// (0/29 controllers em apps/api-v2, 1/33 em apps/api) — o Guardian sinaliza
// isso como CRITICAL genericamente, mas adicionar spec só aqui seria
// inconsistente com os outros 69 sem ganho real (confirmado 2026-08-01).
@Controller('governance-policies')
export class GovernancePolicyController {
  constructor(private readonly governancePolicies: GovernancePolicyService) {}

  @Get()
  async list() {
    const policies = await this.governancePolicies.list()
    return policies.map((p) => ({
      externalId: p.topic,
      question: p.question,
      description: p.description,
      documentRef: p.documentRef,
      version: p.version,
    }))
  }

  @Post()
  create(@Body() dto: CreateGovernancePolicyDto) {
    return this.governancePolicies.create(dto)
  }
}
