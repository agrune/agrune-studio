import type { AgruneManifest, ManifestGroup, ManifestTarget, SelectorLadder } from './types.js'
import { ACTION_KINDS } from './types.js'

export const HASH_CLASS_PATTERN = /\.[a-zA-Z0-9]{8,}(?![a-zA-Z0-9-])/
export const NTH_CHILD_PATTERN = /:nth-child\(/

export interface ValidationError {
  path: string
  message: string
}

export interface ValidationOk {
  ok: true
  manifest: AgruneManifest
}

export interface ValidationFail {
  ok: false
  errors: ValidationError[]
}

export type ValidationResult = ValidationOk | ValidationFail

export function validateManifest(input: unknown): ValidationResult {
  const errors: ValidationError[] = []

  if (!isRecord(input)) {
    return { ok: false, errors: [{ path: '', message: 'manifest must be a JSON object' }] }
  }

  if (input.version !== 3) {
    errors.push({ path: 'version', message: 'version must be 3' })
  }

  if (!Array.isArray(input.groups)) {
    errors.push({ path: 'groups', message: 'groups must be an array' })
  } else {
    input.groups.forEach((group, index) => validateGroup(group, `groups[${index}]`, errors))
  }

  if ('macros' in input && !Array.isArray(input.macros)) {
    errors.push({ path: 'macros', message: 'macros must be an array when present' })
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  return { ok: true, manifest: input as unknown as AgruneManifest }
}

function validateGroup(input: unknown, path: string, errors: ValidationError[]): void {
  if (!isRecord(input)) {
    errors.push({ path, message: 'group must be an object' })
    return
  }

  checkString(input.groupId, `${path}.groupId`, 'groupId', errors)
  checkOptionalString(input.name, `${path}.name`, 'name', errors)
  checkOptionalString(input.desc, `${path}.desc`, 'desc', errors)
  checkOptionalString(input.route, `${path}.route`, 'route', errors)

  if (!Array.isArray(input.targets)) {
    errors.push({ path: `${path}.targets`, message: 'targets must be an array' })
    return
  }

  input.targets.forEach((target, index) => validateTarget(target, `${path}.targets[${index}]`, errors))
}

function validateTarget(input: unknown, path: string, errors: ValidationError[]): void {
  if (!isRecord(input)) {
    errors.push({ path, message: 'target must be an object' })
    return
  }

  checkString(input.targetId, `${path}.targetId`, 'targetId', errors)
  checkOptionalString(input.name, `${path}.name`, 'name', errors)
  checkOptionalString(input.desc, `${path}.desc`, 'desc', errors)

  if (!Array.isArray(input.actionKinds) || input.actionKinds.length < 1) {
    errors.push({ path: `${path}.actionKinds`, message: 'actionKinds must contain at least one action' })
  } else {
    input.actionKinds.forEach((action, index) => {
      if (typeof action !== 'string' || !(ACTION_KINDS as readonly string[]).includes(action)) {
        errors.push({
          path: `${path}.actionKinds[${index}]`,
          message: `action must be one of: ${ACTION_KINDS.join(', ')}`,
        })
      }
    })
  }

  if ('sensitive' in input && input.sensitive !== true) {
    errors.push({
      path: `${path}.sensitive`,
      message: 'sensitive:false is not allowed. Remove the field or set it to true.',
    })
  }

  validateSelector(input.selector, `${path}.selector`, errors)
}

export function validateSelector(input: unknown, path: string, errors: ValidationError[] = []): ValidationError[] {
  if (!isRecord(input)) {
    errors.push({ path, message: 'selector must be an object' })
    return errors
  }

  const selector = input as Partial<SelectorLadder>
  const hasSelector = Boolean(selector.role || selector.text || selector.testId || selector.attr || selector.css)
  if (!hasSelector) {
    errors.push({ path, message: 'selector must define at least one of: role, text, testId, attr, css' })
  }

  if ('role' in selector) {
    if (!isRecord(selector.role)) {
      errors.push({ path: `${path}.role`, message: 'role must be an object' })
    } else {
      checkString(selector.role.name, `${path}.role.name`, 'role.name', errors)
      checkOptionalString(selector.role.level, `${path}.role.level`, 'role.level', errors)
    }
  }

  checkOptionalString(selector.text, `${path}.text`, 'text', errors)
  checkOptionalString(selector.testId, `${path}.testId`, 'testId', errors)
  checkOptionalString(selector.attr, `${path}.attr`, 'attr', errors)
  checkOptionalString(selector.css, `${path}.css`, 'css', errors)

  for (const field of ['attr', 'css'] as const) {
    const value = selector[field]
    if (typeof value !== 'string') continue
    if (HASH_CLASS_PATTERN.test(value)) {
      errors.push({ path: `${path}.${field}`, message: `hash class forbidden ("${value}")` })
    }
    if (NTH_CHILD_PATTERN.test(value)) {
      errors.push({ path: `${path}.${field}`, message: `:nth-child forbidden ("${value}")` })
    }
  }

  return errors
}

export function summarizeManifest(manifest: AgruneManifest): Array<{
  groupId: string
  targetId: string
  actions: string
  selector: string
  sensitive: string
}> {
  return manifest.groups.flatMap((group: ManifestGroup) =>
    group.targets.map((target: ManifestTarget) => ({
      groupId: group.groupId,
      targetId: target.targetId,
      actions: target.actionKinds.join(','),
      selector: describeSelector(target.selector),
      sensitive: target.sensitive ? 'yes' : 'no',
    })),
  )
}

function describeSelector(selector: SelectorLadder): string {
  const parts: string[] = []
  if (selector.role) {
    parts.push(selector.role.level ? `role=${selector.role.name} "${selector.role.level}"` : `role=${selector.role.name}`)
  }
  if (selector.text) parts.push(`text="${selector.text}"`)
  if (selector.testId) parts.push(`testId=${selector.testId}`)
  if (selector.attr) parts.push(`attr=${selector.attr}`)
  if (selector.css) parts.push(`css=${selector.css}`)
  return parts.join(' | ')
}

function checkString(value: unknown, path: string, name: string, errors: ValidationError[]): void {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push({ path, message: `${name} must be a non-empty string` })
  }
}

function checkOptionalString(value: unknown, path: string, name: string, errors: ValidationError[]): void {
  if (value !== undefined && typeof value !== 'string') {
    errors.push({ path, message: `${name} must be a string when present` })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
