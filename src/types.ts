export const ACTION_KINDS = ['click', 'fill', 'dblclick', 'contextmenu', 'hover', 'longpress'] as const

export type ActionKind = (typeof ACTION_KINDS)[number]

export interface SelectorLadder {
  role?: { name: string; level?: string }
  text?: string
  testId?: string
  attr?: string
  css?: string
}

export interface ManifestTarget {
  targetId: string
  name?: string
  desc?: string
  actionKinds: ActionKind[]
  selector: SelectorLadder
  sensitive?: true
}

export interface ManifestGroup {
  groupId: string
  name?: string
  desc?: string
  route?: string
  targets: ManifestTarget[]
}

export interface AgruneManifest {
  version: 3
  groups: ManifestGroup[]
}

export function createEmptyManifest(): AgruneManifest {
  return {
    version: 3,
    groups: [],
  }
}

export function isActionKind(value: string): value is ActionKind {
  return (ACTION_KINDS as readonly string[]).includes(value)
}
