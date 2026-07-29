// Escaping RFC4180 mínimo — sem lib nova, dataset é pequeno e o formato é
// simples o suficiente pra não justificar uma dependência. `question`/`answer`
// do QueryAudit podem conter vírgula, aspas ou quebra de linha, então todo
// campo passa pelo escaping, não só os "suspeitos".
function escapeCsvField(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value)
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export interface CsvColumn<T> {
  key: keyof T | ((row: T) => unknown)
  header: string
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const headerLine = columns.map((c) => escapeCsvField(c.header)).join(',')
  const lines = rows.map((row) =>
    columns
      .map((c) => escapeCsvField(typeof c.key === 'function' ? c.key(row) : row[c.key]))
      .join(','),
  )
  return [headerLine, ...lines].join('\r\n')
}
