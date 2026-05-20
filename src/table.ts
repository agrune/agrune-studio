export function renderTable(rows: Array<Record<string, string>>, columns: string[]): string {
  const widths = columns.map((column) =>
    Math.max(column.length, ...rows.map((row) => String(row[column] ?? '').length)),
  )

  const line = columns.map((column, index) => pad(column, widths[index])).join('  ')
  const divider = widths.map((width) => '-'.repeat(width)).join('  ')
  const body = rows.map((row) => columns.map((column, index) => pad(row[column] ?? '', widths[index])).join('  '))

  return [line, divider, ...body].join('\n')
}

function pad(value: string, width: number): string {
  return value.padEnd(width, ' ')
}
