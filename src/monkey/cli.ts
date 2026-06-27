// `agrune-studio monkey <url>` — bounded exploration over declared targets; emits findings + a
// reproducible candidate scenario.

import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { formatMonkeyReport, runMonkey, type MonkeyOptions } from './explore.js'

const MONKEY_USAGE = `Usage:
  agrune-studio monkey <url> [--steps <n>] [--seed <n>] [--out <candidate.json>] [--headed] [--stop-on-first] [--json]`

export async function runMonkeyCli(argv: string[]): Promise<number> {
  const positionals: string[] = []
  const flags = new Map<string, string | true>()
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!
    if (!arg.startsWith('--')) {
      positionals.push(arg)
      continue
    }
    const name = arg.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) flags.set(name, true)
    else {
      flags.set(name, next)
      i += 1
    }
  }

  const url = positionals[0]
  if (!url || flags.get('help') === true) {
    console.log(MONKEY_USAGE)
    return url ? 0 : 1
  }

  const opts: MonkeyOptions = { url, headless: flags.get('headed') !== true }
  if (typeof flags.get('steps') === 'string') opts.maxSteps = Number(flags.get('steps'))
  if (typeof flags.get('seed') === 'string') opts.seed = Number(flags.get('seed'))
  if (flags.get('stop-on-first') === true) opts.stopOnFirst = true

  const report = await runMonkey(opts)

  if (flags.get('json') === true) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(formatMonkeyReport(report))
  }

  const out = flags.get('out')
  if (typeof out === 'string' && report.findings[0]) {
    const file = path.resolve(process.cwd(), out)
    await writeFile(file, `${JSON.stringify(report.findings[0].candidate, null, 2)}\n`, 'utf8')
    console.log(`Wrote candidate scenario: ${file}`)
  }

  // A finding means the monkey surfaced a bug → non-zero so CI can gate on it.
  return report.findings.length > 0 ? 1 : 0
}
