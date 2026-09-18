import { readFileSync, readdirSync, existsSync, statSync } from 'fs'
import { join } from 'path'

/**
 * ── Migração quebrada não dá erro de teste: derruba a API na subida ──────────
 *
 * `migrate deploy` roda no boot da V1. Uma migração malformada — pasta sem `migration.sql`,
 * arquivo vazio, timestamp fora de ordem — não falha em lugar nenhum antes disso: falha quando o
 * container sobe, e o sintoma é a aplicação fora do ar. Mesma classe do ciclo de módulos de
 * 14/09: o defeito só existe no boot, e nenhum spec unitário o alcança.
 *
 * As 29 migrações desta casa são escritas **à mão** (`migrate dev` falha com shadow DB em schema
 * múltiplo, registrado em `CLAUDE.local.md`), então não há ferramenta gerando o nome nem
 * conferindo o formato. É exatamente onde erro de digitação passa.
 *
 * O invariante `migracoes_aplicadas` compara o DIRETÓRIO com o banco em produção; este teste olha
 * antes, no que vai ser publicado.
 */
describe('migrações do Prisma são aplicáveis', () => {
  const RAIZ = join(__dirname, '..', '..', 'prisma', 'migrations')

  const pastas = readdirSync(RAIZ).filter((n) => statSync(join(RAIZ, n)).isDirectory())

  it('encontra o diretório de migrações', () => {
    expect(pastas.length).toBeGreaterThan(20)
  })

  /**
   * ── A exceção é nomeada, e não pode ser consertada ──────────────────────────
   *
   * `20260405174948_` é a migração que criou `projects`, em 05/04, e nasceu **sem nome** —
   * alguém deu Enter no prompt do `migrate dev --name`. O SQL é válido e ela está aplicada.
   *
   * Renomear a pasta parece a correção óbvia e **derrubaria a API**: `_prisma_migrations` a
   * registra com esse nome exato (conferido em produção), então a pasta renomeada viraria uma
   * migração NOVA para o `migrate deploy`, que tentaria rodar `CREATE TABLE projects` de novo,
   * falharia, e falha de migração bloqueia o boot da V1.
   *
   * Exceção por nome em vez de regex mais frouxa: afrouxar a regra para acomodar um caso
   * histórico deixaria passar o próximo erro de digitação, que é o que este teste existe para
   * pegar. Mesma escolha do `SO_NEGACAO` — estreito de propósito.
   */
  const NASCEU_SEM_NOME = new Set(['20260405174948_'])

  it.each(pastas)('%s tem nome no formato <timestamp>_<nome>', (pasta) => {
    if (NASCEU_SEM_NOME.has(pasta)) {
      expect(pasta).toMatch(/^\d{14}_$/)
      return
    }
    expect(pasta).toMatch(/^\d{14}_[a-z0-9_]+$/)
  })

  /**
   * Pasta sem `migration.sql` faz o `migrate deploy` abortar — e abortar no boot é a aplicação
   * não subir. Arquivo vazio é pior: aplica, marca como aplicada, e some da lista sem ter feito
   * nada.
   */
  it.each(pastas)('%s tem migration.sql com conteúdo', (pasta) => {
    const sql = join(RAIZ, pasta, 'migration.sql')
    expect(existsSync(sql)).toBe(true)
    expect(readFileSync(sql, 'utf8').trim().length).toBeGreaterThan(0)
  })

  /** Timestamp repetido torna a ordem de aplicação indefinida entre as duas. */
  it('nenhum timestamp se repete', () => {
    const marcas = pastas.map((p) => p.slice(0, 14))
    expect(new Set(marcas).size).toBe(marcas.length)
  })

  /**
   * `20261316…` ordena depois de `20261215…` e é um mês que não existe. O nome ordena certo e a
   * data mente — o tipo de erro que só aparece quando a próxima migração cair no meio.
   */
  it.each(pastas)('%s tem um timestamp que é uma data real', (pasta) => {
    const [, ano, mes, dia, hora, min, seg] = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(pasta)!
    expect(Number(mes)).toBeGreaterThanOrEqual(1)
    expect(Number(mes)).toBeLessThanOrEqual(12)
    expect(Number(dia)).toBeGreaterThanOrEqual(1)
    expect(Number(dia)).toBeLessThanOrEqual(31)
    expect(Number(hora)).toBeLessThanOrEqual(23)
    expect(Number(min)).toBeLessThanOrEqual(59)
    expect(Number(seg)).toBeLessThanOrEqual(59)
    expect(Number(ano)).toBeGreaterThanOrEqual(2024)
  })
})

/**
 * ── `task_logs` tinha um escritor e zero leitores (A03) ──────────────────────
 *
 * `AgentSessionService.create()` gravava a sessão na tabela e **nunca enfileirava**: o pedido
 * parecia aceito e não alcançava o executor. O conteúdo era a própria evidência — as 5 linhas
 * eram `jarvis:supervised_session` presas em `pending` desde 31/05, nenhuma executada.
 *
 * O escritor saiu em 14/09; a tabela saiu agora. Backup das 5 linhas em
 * `~/backups/task_logs-pre-drop-20260916-135738.sql` no servidor.
 */
describe('a tabela morta não volta', () => {
  const schema = readFileSync(join(__dirname, '..', '..', 'prisma', 'schema.prisma'), 'utf8')

  it('o modelo saiu do schema', () => {
    expect(schema).not.toMatch(/model TaskLog\b/)
    expect(schema).not.toMatch(/@@map\("task_logs"\)/)
  })

  it('existe a migração que apaga a tabela', () => {
    const drop = readdirSync(join(__dirname, '..', '..', 'prisma', 'migrations'))
      .find((p) => p.endsWith('_drop_task_logs'))
    expect(drop).toBeDefined()

    const sql = readFileSync(join(__dirname, '..', '..', 'prisma', 'migrations', drop!, 'migration.sql'), 'utf8')
    // `IF EXISTS` porque migração que falha bloqueia o boot, e um ambiente sem a tabela não pode
    // derrubar a api por causa disso.
    expect(sql).toMatch(/DROP TABLE IF EXISTS "task_logs"/)
  })
})
