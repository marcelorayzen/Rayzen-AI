import { readFileSync } from 'fs'
import { join } from 'path'
import { Prisma } from '@prisma/client'
import { PrismaExceptionFilter, STATUS_POR_CODIGO_PRISMA } from '../prisma-exception.filter'

/**
 * Erro de constraint do Prisma virava `500 Internal server error` em toda rota.
 *
 * Dois casos medidos em 2026-08-16:
 *   GET /projects/<id inexistente>              -> 500  (findUniqueOrThrow, P2025)
 *   DELETE /memory/documents/<citado por wiki>  -> 500  (FK do wiki, P2003)
 *
 * O segundo é o pior: o banco estava funcionando como projetado, protegendo a
 * procedência de um documento citado por uma página de wiki, e reportava isso como
 * falha do servidor. Quem chama não tinha como saber que a operação foi RECUSADA e
 * não que o servidor caiu.
 */
describe('PrismaExceptionFilter', () => {
  function chamar(code: string, meta?: Record<string, unknown>) {
    const enviado: { status?: number; corpo?: Record<string, unknown> } = {}
    const reply = {
      status(s: number) { enviado.status = s; return this },
      send(c: Record<string, unknown>) { enviado.corpo = c; return this },
    }
    const host = { switchToHttp: () => ({ getResponse: () => reply }) }

    const erro = new Prisma.PrismaClientKnownRequestError('falhou', {
      code, clientVersion: '5.0.0', meta,
    })
    new PrismaExceptionFilter().catch(erro, host as never)
    return enviado
  }

  it('P2025 (registro não encontrado) vira 404, não 500', () => {
    const r = chamar('P2025')

    expect(r.status).toBe(404)
    expect(r.corpo).toMatchObject({ statusCode: 404, code: 'P2025' })
  })

  it('P2003 (chave estrangeira) vira 409 — foi recusa, não queda', () => {
    const r = chamar('P2003', { field_name: 'wiki_source_references_document_id_fkey' })

    expect(r.status).toBe(409)
    expect(r.corpo?.detalhe).toContain('wiki_source_references')
  })

  it('P2002 (valor único duplicado) vira 409 e nomeia o campo', () => {
    const r = chamar('P2002', { target: ['repo_slug'] })

    expect(r.status).toBe(409)
    expect(r.corpo?.detalhe).toBe('repo_slug')
  })

  it('código não mapeado CONTINUA 500 — inventar 4xx esconde defeito de servidor', () => {
    const r = chamar('P1001')  // não consegue conectar no banco: isto é queda mesmo

    expect(r.status).toBe(500)
    expect(r.corpo).toEqual({ statusCode: 500, message: 'Internal server error' })
  })

  it('sem meta, responde sem o campo detalhe em vez de "undefined"', () => {
    const r = chamar('P2025')

    expect(r.corpo).not.toHaveProperty('detalhe')
  })

  /**
   * A V2 tem o filtro gêmeo porque `packages/types` não é compilado e não pode
   * carregar código de runtime — mesma restrição do `memory-ranking.const.ts`.
   * A tabela é o que não pode divergir: um app respondendo 404 e o outro 500 para
   * a mesma condição é pior que os dois responderem 500.
   */
  it('a tabela de status é idêntica à da api-v2', () => {
    const gemeo = join(
      __dirname, '..', '..', '..', '..', 'api-v2', 'src', 'common', 'prisma-exception.filter.ts',
    )
    const fonte = readFileSync(gemeo, 'utf8')

    const bloco = fonte.match(/STATUS_POR_CODIGO_PRISMA[^=]*= \{([\s\S]*?)\n\}/)?.[1]
    expect(bloco).toBeDefined()

    for (const [codigo, { status }] of Object.entries(STATUS_POR_CODIGO_PRISMA)) {
      expect(bloco).toContain(`${codigo}: { status: ${status},`)
    }
    // Sem códigos a mais do outro lado.
    expect((bloco!.match(/P\d{4}:/g) ?? []).sort())
      .toEqual(Object.keys(STATUS_POR_CODIGO_PRISMA).map((c) => `${c}:`).sort())
  })
})
