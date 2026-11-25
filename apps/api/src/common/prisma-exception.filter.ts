import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { FastifyReply } from 'fastify'

/**
 * Traduz erro conhecido do Prisma em status HTTP.
 *
 * Sem isto, toda violação de constraint virava `500 Internal server error` — e o
 * cliente não conseguia distinguir "não existe" de "o servidor quebrou". Dois casos
 * medidos em 2026-08-16:
 *
 *   GET /projects/<id inexistente>              -> 500   (findUniqueOrThrow, P2025)
 *   DELETE /memory/documents/<citado por wiki>  -> 500   (FK do wiki, P2003)
 *
 * O segundo é o mais enganoso: o banco estava **funcionando como projetado**,
 * protegendo a procedência de um documento citado por uma página de wiki, e
 * reportava isso como falha do servidor.
 *
 * São 40 pontos de chamada só nesta app que podem emitir esses erros (`OrThrow`,
 * `delete`, `update`), o que é o motivo de isto ser um filtro global e não um
 * try/catch em duas rotas.
 *
 * ⚠️  Este arquivo é gêmeo de `apps/api-v2/src/common/prisma-exception.filter.ts`.
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

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter<Prisma.PrismaClientKnownRequestError> {
  private readonly logger = new Logger(PrismaExceptionFilter.name)

  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost): void {
    const reply    = host.switchToHttp().getResponse<FastifyReply>()
    const mapeado  = STATUS_POR_CODIGO_PRISMA[exception.code]

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
