import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common'
import { Prisma as PrismaV1 } from '@prisma/client'
import { Prisma as PrismaV2 } from '../../generated/prisma-client-v2'
import type { FastifyReply } from 'fastify'

/**
 * Traduz erro conhecido do Prisma em status HTTP.
 *
 * Sem isto, toda violação de constraint virava `500 Internal server error` — e o
 * cliente não conseguia distinguir "não existe" de "o servidor quebrou". Medido em
 * 2026-08-16 na V1: `GET /projects/<id inexistente>` devolvia 500 (P2025) e um
 * `DELETE` bloqueado por chave estrangeira também (P2003). O segundo é o mais
 * enganoso: o banco estava **funcionando como projetado**, protegendo a procedência
 * de um documento citado por wiki, e reportava isso como falha do servidor.
 *
 * ─── Por que DUAS classes no @Catch ──────────────────────────────────────────
 *
 * Esta app fala com dois clientes Prisma diferentes: o gerado em
 * `generated/prisma-client-v2` (schema `v2`) e o `@prisma/client` que o
 * `V1BridgeService` usa para ler o schema `public`. Cada um traz a SUA classe
 * `PrismaClientKnownRequestError`, e `@Catch` compara identidade de classe, não
 * formato. Registrar só uma deixaria metade dos erros virando 500 — e seria a
 * metade silenciosa, porque as duas têm exatamente a mesma cara em log.
 *
 * ⚠️  A tabela abaixo é gêmea de `apps/api/src/common/prisma-exception.filter.ts`.
 * A duplicação é consciente — `packages/types` não é compilado e não pode carregar
 * código de runtime — e o drift é barrado por `prisma-exception-filter.spec.ts`,
 * que lê o arquivo da outra app como texto e falha se a tabela divergir.
 */

/** Só códigos que descrevem uma condição do CLIENTE. Ver nota sobre o default. */
export const STATUS_POR_CODIGO_PRISMA: Record<string, { status: number; message: string }> = {
  P2025: { status: 404, message: 'Registro não encontrado' },
  P2002: { status: 409, message: 'Já existe registro com esse valor único' },
  P2003: { status: 409, message: 'Registro referenciado por outro — remova a referência antes' },
}

/** Campo ou tabela que o Prisma nomeia, quando nomeia. */
export function detalheDoErroPrisma(meta: Record<string, unknown> | undefined): string | undefined {
  if (!meta) return undefined
  const alvo = meta.target ?? meta.field_name ?? meta.modelName
  if (!alvo) return undefined
  return Array.isArray(alvo) ? alvo.join(', ') : String(alvo)
}

type ErroConhecido = { code: string; message: string; meta?: unknown }

@Catch(PrismaV2.PrismaClientKnownRequestError, PrismaV1.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name)

  catch(exception: ErroConhecido, host: ArgumentsHost): void {
    const reply   = host.switchToHttp().getResponse<FastifyReply>()
    const mapeado = STATUS_POR_CODIGO_PRISMA[exception.code]

    // Código não mapeado continua 500 de propósito. Inventar um 4xx para o que não
    // se entende transforma defeito de servidor em "culpa do cliente" e o esconde.
    if (!mapeado) {
      this.logger.error(`Prisma ${exception.code} não mapeado: ${exception.message}`)
      void reply.status(500).send({ statusCode: 500, message: 'Internal server error' })
      return
    }

    const detalhe = detalheDoErroPrisma(exception.meta as Record<string, unknown> | undefined)
    void reply.status(mapeado.status).send({
      statusCode: mapeado.status,
      message:    mapeado.message,
      code:       exception.code,
      ...(detalhe ? { detalhe } : {}),
    })
  }
}
