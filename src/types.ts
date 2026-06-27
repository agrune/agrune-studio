import { ActionKindSchema, defineManifest } from '@agrune/manifest'
import type {
  ActionKind,
  AgruneManifest,
  ManifestGroup,
  ManifestRepeat,
  ManifestTarget,
  SelectorLadder,
} from '@agrune/manifest'

export const ACTION_KINDS = ActionKindSchema.options

export function createEmptyManifest(): AgruneManifest {
  return defineManifest({ groups: [] })
}

export function isActionKind(value: string): value is ActionKind {
  return ActionKindSchema.safeParse(value).success
}

export type {
  ActionKind,
  AgruneManifest,
  ManifestGroup,
  ManifestRepeat,
  ManifestTarget,
  SelectorLadder,
}
