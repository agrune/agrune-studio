import type { AgruneManifest, ManifestGroup, ManifestTarget, SelectorLadder } from './types.js'

export {
  HASH_CLASS_PATTERN,
  NTH_CHILD_PATTERN,
  SelectorForbiddenError,
  assertNoHashClass,
  assertNoNthChild,
  validateManifest,
} from '@agrune/manifest'

export type {
  ValidateFail,
  ValidateOk,
  ValidateResult,
} from '@agrune/manifest'

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
