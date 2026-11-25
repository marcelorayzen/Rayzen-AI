import { FILTER_CATCH_EXCEPTIONS } from '@nestjs/common/constants'
import { Prisma as PrismaV1 } from '@prisma/client'
import { Prisma as PrismaV2 } from '../../../generated/prisma-client-v2'
import { PrismaExceptionFilter } from '../prisma-exception.filter'

/**
 * O que é específico da V2: ela fala com DOIS clientes Prisma.
 *
 * O gerado em `generated/prisma-client-v2` (schema `v2`) e o `@prisma/client` que o
 * `V1BridgeService` usa para ler o `public`. Cada um traz a sua própria classe
 * `PrismaClientKnownRequestError`, e `@Catch` compara identidade de classe, não
 * formato — registrar só uma deixaria metade dos erros virando 500. E seria a
 * metade silenciosa: as duas são idênticas em log.
 */
describe('PrismaExceptionFilter (api-v2)', () => {
  function chamar(erro: unknown) {
    const enviado: { status?: number; corpo?: Record<string, unknown> } = {}
    const reply = {
      status(s: number) { enviado.status = s; return this },
      send(c: Record<string, unknown>) { enviado.corpo = c; return this },
    }
    const host = { switchToHttp: () => ({ getResponse: () => reply }) }
    new PrismaExceptionFilter().catch(erro as never, host as never)
    return enviado
  }

  it('as DUAS classes de erro estão registradas no @Catch', () => {
    const capturadas = Reflect.getMetadata(FILTER_CATCH_EXCEPTIONS, PrismaExceptionFilter) as unknown[]

    expect(capturadas).toContain(PrismaV2.PrismaClientKnownRequestError)
    expect(capturadas).toContain(PrismaV1.PrismaClientKnownRequestError)
  })

  it('as duas classes são de fato distintas — não é redundância no @Catch', () => {
    // Se um dia virarem a mesma classe, este teste avisa que o @Catch duplo
    // deixou de ser necessário, em vez de deixar a redundância sem explicação.
    expect(PrismaV2.PrismaClientKnownRequestError)
      .not.toBe(PrismaV1.PrismaClientKnownRequestError)
  })

  it('erro vindo do cliente da V2 vira 404', () => {
    const erro = new PrismaV2.PrismaClientKnownRequestError('falhou', {
      code: 'P2025', clientVersion: '5.0.0',
    })

    expect(chamar(erro).status).toBe(404)
  })

  it('erro vindo do cliente V1 (bridge) vira 409 na chave estrangeira', () => {
    const erro = new PrismaV1.PrismaClientKnownRequestError('falhou', {
      code: 'P2003', clientVersion: '5.0.0', meta: { field_name: 'documents_project_id_fkey' },
    })
    const r = chamar(erro)

    expect(r.status).toBe(409)
    expect(r.corpo?.detalhe).toContain('documents_project_id')
  })

  it('código não mapeado continua 500', () => {
    const erro = new PrismaV2.PrismaClientKnownRequestError('sem conexão', {
      code: 'P1001', clientVersion: '5.0.0',
    })

    expect(chamar(erro).status).toBe(500)
  })
})
