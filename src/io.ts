import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AgruneManifest } from './types.js'
import { validateManifest } from './validator.js'

export async function readManifestFile(filePath: string): Promise<AgruneManifest> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch (err) {
    throw new Error(`failed to read ${filePath}: ${(err as Error).message}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`invalid JSON in ${filePath}: ${(err as Error).message}`)
  }

  const result = validateManifest(parsed)
  if (!result.ok) {
    throw new Error(formatValidationErrors(result.errors))
  }
  return result.manifest
}

export async function writeManifestFile(filePath: string, manifest: AgruneManifest): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

export function resolveOutputPath(outPath: string): string {
  return path.resolve(process.cwd(), outPath)
}

export function formatValidationErrors(errors: Array<{ path: string; message: string }>): string {
  return errors.map((error) => `- ${error.path || '(root)'}: ${error.message}`).join('\n')
}
