import * as fs from 'fs'
import * as path from 'path'

// Guardian sinaliza qualquer migration sem um arquivo companheiro com
// "__tests__" e "migration" no path (ver risk-scorer.service.ts do
// apps/api-v2, regra migrationSemTeste) — nenhuma das 41 migrations do
// monorepo (3 apps) jamais satisfez isso, não havia padrão pra copiar.
// Escopo deliberado: verifica consistência ESTÁTICA entre migration.sql e
// down.sql (o nome da tabela criada é o mesmo revertido) — NÃO aplica os
// scripts contra um Postgres real. Nenhum dos outros specs deste app toca
// banco de verdade (rootDir: "src" no jest config já exclui qualquer coisa
// fora daqui); introduzir a primeira dependência de banco vivo só pra esta
// regra seria desproporcional a uma convenção nunca antes exigida.
const MIGRATION_DIR = path.join(__dirname, '..', '..', '..', 'prisma', 'migrations', '20260801150000_governance_policy')

function readSql(filename: string): string {
  return fs.readFileSync(path.join(MIGRATION_DIR, filename), 'utf-8')
}

describe('migration 20260801150000_governance_policy — down.sql reverte migration.sql', () => {
  it('down.sql existe', () => {
    expect(fs.existsSync(path.join(MIGRATION_DIR, 'down.sql'))).toBe(true)
  })

  it('migration.sql cria exatamente a tabela que down.sql derruba', () => {
    const up = readSql('migration.sql')
    const down = readSql('down.sql')

    const createMatch = up.match(/CREATE TABLE "([^"]+)"/)
    const dropMatch = down.match(/DROP TABLE IF EXISTS "([^"]+)"/)

    expect(createMatch).not.toBeNull()
    expect(dropMatch).not.toBeNull()
    expect(dropMatch![1]).toBe(createMatch![1])
  })

  it('migration.sql não altera nenhuma tabela pré-existente (escopo assumido pelo down.sql simples)', () => {
    const up = readSql('migration.sql')
    // Se um dia esta migration passar a fazer ALTER TABLE numa tabela já
    // existente, um DROP TABLE simples deixa de ser reversão suficiente —
    // este teste falha de propósito pra forçar revisão do down.sql.
    expect(up).not.toMatch(/ALTER TABLE/i)
  })

  it('down.sql usa IF EXISTS (reversão idempotente, não falha se já foi revertido)', () => {
    const down = readSql('down.sql')
    expect(down).toMatch(/DROP TABLE IF EXISTS/i)
  })
})
