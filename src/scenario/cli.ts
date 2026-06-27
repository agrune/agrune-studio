// `agrune-studio scenario <new|validate|run>` — authoring + deterministic replay + report view.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createEmptyScenario, validateScenario, type Scenario } from './schema.js'
import { runScenario, type RunOptions } from './runner.js'
import { formatReport } from './report.js'
import { formatRepairReport, repairScenario, type RepairOptions } from './heal.js'

interface ParsedArgs {
  positionals: string[]
  flags: Map<string, string | true>
}

const SCENARIO_USAGE = `Usage:
  agrune-studio scenario new --out <file> [--name <name>]
  agrune-studio scenario validate <file>
  agrune-studio scenario run <file> [--url <app>] [--headed] [--artifacts <dir>] [--json]
  agrune-studio scenario repair <file> [--url <app>] [--headed] [--write-merged <file>] [--json]`

export async function runScenarioCli(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv
  if (!sub || sub === '--help' || sub === '-h') {
    console.log(SCENARIO_USAGE)
    return sub ? 0 : 1
  }
  const args = parseArgs(rest)
  if (sub === 'new') return runNew(args)
  if (sub === 'validate') return runValidate(args)
  if (sub === 'run') return runRun(args)
  if (sub === 'repair') return runRepair(args)
  throw new Error(`unknown scenario subcommand: ${sub}\n\n${SCENARIO_USAGE}`)
}

async function runNew(args: ParsedArgs): Promise<number> {
  const out = getRequiredFlag(args, 'out')
  const name = typeof args.flags.get('name') === 'string' ? (args.flags.get('name') as string) : 'new scenario'
  const outPath = path.resolve(process.cwd(), out)
  await mkdir(path.dirname(outPath), { recursive: true })
  await writeFile(outPath, `${JSON.stringify(createEmptyScenario(name), null, 2)}\n`, 'utf8')
  console.log(`Created ${outPath}`)
  return 0
}

async function runValidate(args: ParsedArgs): Promise<number> {
  const file = getRequiredPositional(args, 0, 'file')
  const result = validateScenario(await readJson(file))
  if (!result.ok) {
    console.error(`Scenario invalid in ${file}:`)
    console.error(result.errors.map((e) => `- ${e.path || '(root)'}: ${e.message}`).join('\n'))
    return 1
  }
  console.log(`Scenario OK (${result.scenario.steps.length} steps).`)
  return 0
}

async function runRun(args: ParsedArgs): Promise<number> {
  const file = getRequiredPositional(args, 0, 'file')
  const scenario = await loadScenario(file)

  const opts: RunOptions = { headless: args.flags.get('headed') !== true }
  const url = args.flags.get('url')
  if (typeof url === 'string') opts.url = url
  const artifacts = args.flags.get('artifacts')
  if (typeof artifacts === 'string') {
    opts.artifactsDir = path.resolve(process.cwd(), artifacts)
    opts.screenshots = true
  }

  const report = await runScenario(scenario, opts)
  if (args.flags.get('json') === true) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(formatReport(report))
  }
  return report.status === 'pass' ? 0 : 1
}

async function runRepair(args: ParsedArgs): Promise<number> {
  const file = getRequiredPositional(args, 0, 'file')
  const scenario = await loadScenario(file)

  const opts: RepairOptions = { headless: args.flags.get('headed') !== true }
  const url = args.flags.get('url')
  if (typeof url === 'string') opts.url = url
  const writeMerged = args.flags.get('write-merged')
  if (typeof writeMerged === 'string') opts.writeMergedTo = path.resolve(process.cwd(), writeMerged)

  const report = await repairScenario(scenario, opts)
  if (args.flags.get('json') === true) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(formatRepairReport(report))
  }
  // exit 0 if green-or-healed; 1 if it still needs a human
  return report.status === 'needs-human' ? 1 : 0
}

// ---- helpers ---------------------------------------------------------------

async function loadScenario(file: string): Promise<Scenario> {
  const result = validateScenario(await readJson(file))
  if (!result.ok) {
    throw new Error(
      `Refusing to run an invalid scenario (${file}):\n` +
        result.errors.map((e) => `- ${e.path || '(root)'}: ${e.message}`).join('\n'),
    )
  }
  return result.scenario
}

async function readJson(file: string): Promise<unknown> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (err) {
    throw new Error(`failed to read ${file}: ${(err as Error).message}`)
  }
  try {
    return JSON.parse(raw)
  } catch (err) {
    throw new Error(`invalid JSON in ${file}: ${(err as Error).message}`)
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = []
  const flags = new Map<string, string | true>()
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!
    if (!arg.startsWith('--')) {
      positionals.push(arg)
      continue
    }
    const name = arg.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      flags.set(name, true)
      continue
    }
    flags.set(name, next)
    index += 1
  }
  return { positionals, flags }
}

function getRequiredPositional(args: ParsedArgs, index: number, name: string): string {
  const value = args.positionals[index]
  if (!value) throw new Error(`missing <${name}>\n\n${SCENARIO_USAGE}`)
  return value
}

function getRequiredFlag(args: ParsedArgs, name: string): string {
  const value = args.flags.get(name)
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`missing --${name}\n\n${SCENARIO_USAGE}`)
  return value
}
