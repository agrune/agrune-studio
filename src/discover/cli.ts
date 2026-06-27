// `agrune-studio discover <url> --scenarios <dir>` — propose uncovered flows + coverage delta;
// `--adopt <i> --out <file>` writes the chosen proposal as a scenario (the human's adoption step).

import path from 'node:path'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { validateScenario, type Scenario } from '../scenario/schema.js'
import { formatDiscoveryReport, runDiscovery, type DiscoveryOptions } from './discover.js'

const DISCOVER_USAGE = `Usage:
  agrune-studio discover <url> [--scenarios <dir>] [--headed] [--json]
  agrune-studio discover <url> --scenarios <dir> --adopt <i> --out <file>`

export async function runDiscoverCli(argv: string[]): Promise<number> {
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
    console.log(DISCOVER_USAGE)
    return url ? 0 : 1
  }

  const opts: DiscoveryOptions = { url, headless: flags.get('headed') !== true }
  const scenariosDir = flags.get('scenarios')
  if (typeof scenariosDir === 'string') opts.existing = await loadScenarios(path.resolve(process.cwd(), scenariosDir))

  const report = await runDiscovery(opts)

  if (flags.get('json') === true) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(formatDiscoveryReport(report))
  }
  if (report.error) return 1

  const adopt = flags.get('adopt')
  if (typeof adopt === 'string') {
    const index = Number(adopt)
    const proposal = report.proposals[index]
    if (!proposal) {
      console.error(`no proposal at index ${index} (have ${report.proposals.length})`)
      return 1
    }
    const out = flags.get('out')
    if (typeof out !== 'string') {
      console.error('--adopt requires --out <file>')
      return 1
    }
    const file = path.resolve(process.cwd(), out)
    await writeFile(file, `${JSON.stringify(proposal.scenario, null, 2)}\n`, 'utf8')
    console.log(`Adopted proposal [${index}] "${proposal.name}" -> ${file}`)
  }
  return 0
}

/** Load + validate every *.json scenario in a directory (skips non-scenario JSON). */
async function loadScenarios(dir: string): Promise<Scenario[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }
  const scenarios: Scenario[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    try {
      const raw = await readFile(path.join(dir, entry), 'utf8')
      const result = validateScenario(JSON.parse(raw))
      if (result.ok) scenarios.push(result.scenario)
    } catch {
      // skip unreadable / non-scenario JSON
    }
  }
  return scenarios
}
