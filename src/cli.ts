#!/usr/bin/env node
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { createEmptyManifest, isActionKind, type AgruneManifest, type ManifestTarget, type SelectorLadder } from './types.js'
import { formatValidationErrors, readManifestFile, resolveOutputPath, writeManifestFile } from './io.js'
import { renderTable } from './table.js'
import { summarizeManifest, validateManifest } from './validator.js'

interface ParsedArgs {
  positionals: string[]
  flags: Map<string, string | true>
}

const USAGE = `Usage:
  agrune-studio init --out agrune.manifest.json
  agrune-studio validate <file>
  agrune-studio add-target <file> --group <id> --target <id> --action <click|fill|dblclick|contextmenu|hover|longpress> --role <role> [--text <text>] [--css <css>] [--test-id <id>] [--attr <selector>] [--sensitive]
  agrune-studio print <file>`

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const [command, ...rest] = argv
  if (!command || command === '--help' || command === '-h') {
    console.log(USAGE)
    return command ? 0 : 1
  }

  try {
    if (command === 'init') return await runInit(parseArgs(rest))
    if (command === 'validate') return await runValidate(parseArgs(rest))
    if (command === 'add-target') return await runAddTarget(parseArgs(rest))
    if (command === 'print') return await runPrint(parseArgs(rest))
    throw new Error(`unknown command: ${command}\n\n${USAGE}`)
  } catch (err) {
    console.error((err as Error).message)
    return 1
  }
}

async function runInit(args: ParsedArgs): Promise<number> {
  const out = getRequiredFlag(args, 'out')
  const outPath = resolveOutputPath(out)
  await mkdir(path.dirname(outPath), { recursive: true })
  await writeManifestFile(outPath, createEmptyManifest())
  console.log(`Created ${outPath}`)
  return 0
}

async function runValidate(args: ParsedArgs): Promise<number> {
  const file = getRequiredPositional(args, 0, 'file')
  const raw = await import('node:fs/promises').then((fs) => fs.readFile(file, 'utf8'))
  const parsed = JSON.parse(raw) as unknown
  const result = validateManifest(parsed)
  if (!result.ok) {
    console.error(`Validation failed in ${file}:`)
    console.error(formatValidationErrors(result.errors))
    return 1
  }

  const targetCount = result.manifest.groups.reduce((sum, group) => sum + group.targets.length, 0)
  console.log(`Manifest OK (${result.manifest.groups.length} groups, ${targetCount} targets).`)
  return 0
}

async function runAddTarget(args: ParsedArgs): Promise<number> {
  const file = getRequiredPositional(args, 0, 'file')
  const groupId = getRequiredFlag(args, 'group')
  const targetId = getRequiredFlag(args, 'target')
  const action = getRequiredFlag(args, 'action')
  if (!isActionKind(action)) {
    throw new Error(`--action must be one of: click, fill, dblclick, contextmenu, hover, longpress`)
  }

  const selector = buildSelector(args)
  const manifest = await readManifestFile(file)
  const target: ManifestTarget = {
    targetId,
    actionKinds: [action],
    selector,
  }
  if (args.flags.get('sensitive') === true) {
    target.sensitive = true
  }

  upsertTarget(manifest, groupId, target)
  const validation = validateManifest(manifest)
  if (!validation.ok) {
    throw new Error(`Refusing to write invalid manifest:\n${formatValidationErrors(validation.errors)}`)
  }

  await writeManifestFile(file, manifest)
  console.log(`Upserted target "${targetId}" in group "${groupId}".`)
  return 0
}

async function runPrint(args: ParsedArgs): Promise<number> {
  const file = getRequiredPositional(args, 0, 'file')
  const manifest = await readManifestFile(file)
  const rows = summarizeManifest(manifest)
  if (rows.length === 0) {
    console.log('No targets.')
    return 0
  }

  console.log(renderTable(rows, ['groupId', 'targetId', 'actions', 'selector', 'sensitive']))
  return 0
}

function upsertTarget(manifest: AgruneManifest, groupId: string, target: ManifestTarget): void {
  let group = manifest.groups.find((candidate) => candidate.groupId === groupId)
  if (!group) {
    group = { groupId, targets: [] }
    manifest.groups.push(group)
  }

  const existingIndex = group.targets.findIndex((candidate) => candidate.targetId === target.targetId)
  if (existingIndex === -1) {
    group.targets.push(target)
  } else {
    group.targets[existingIndex] = target
  }
}

function buildSelector(args: ParsedArgs): SelectorLadder {
  const selector: Partial<SelectorLadder> = {}
  const role = args.flags.get('role')
  if (typeof role === 'string') {
    selector.role = { name: role }
  }
  assignStringFlag(args, 'text', (value) => {
    selector.text = value
  })
  assignStringFlag(args, 'test-id', (value) => {
    selector.testId = value
  })
  assignStringFlag(args, 'attr', (value) => {
    selector.attr = value
  })
  assignStringFlag(args, 'css', (value) => {
    selector.css = value
  })
  return selector as SelectorLadder
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = []
  const flags = new Map<string, string | true>()

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
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
  if (!value) throw new Error(`missing <${name}>\n\n${USAGE}`)
  return value
}

function getRequiredFlag(args: ParsedArgs, name: string): string {
  const value = args.flags.get(name)
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`missing --${name}\n\n${USAGE}`)
  }
  return value
}

function assignStringFlag(args: ParsedArgs, name: string, assign: (value: string) => void): void {
  const value = args.flags.get(name)
  if (typeof value === 'string') {
    assign(value)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main()
}
