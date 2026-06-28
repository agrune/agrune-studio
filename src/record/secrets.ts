// Write-only secret vault (local diagnostic infra). setSecret stores a value; resolveSecret is used
// ONLY by the deterministic runner to inject at execution. No code path returns a stored value to an
// API response, UI, extract, export, or log — read-back is forbidden by design. hasSecret returns a
// boolean only (presence, never the value).

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

async function load(dir: string): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(path.join(dir, 'secrets.json'), 'utf8')) as Record<string, string>
  } catch {
    return {}
  }
}

export async function setSecret(dir: string, name: string, value: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  const all = await load(dir)
  all[name] = value
  await writeFile(path.join(dir, 'secrets.json'), JSON.stringify(all, null, 2), 'utf8')
}

export async function resolveSecret(dir: string, name: string): Promise<string | undefined> {
  const all = await load(dir)
  return all[name]
}

export async function hasSecret(dir: string, name: string): Promise<boolean> {
  const all = await load(dir)
  return Object.prototype.hasOwnProperty.call(all, name)
}
