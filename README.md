# Agrune Studio

Agrune Studio CLI MVP for creating, validating, editing, and printing Agrune manifest JSON files.

## Manifest truth lives in the core

The manifest schema, types, validator, and selector policy are **imported from `@agrune/manifest`** —
the single source of truth re-cut from the `agrune` core (`packages/manifest`, SPEC §6 / PLAN Phase 0).
Studio does **not** re-implement validation; it calls the same `validateManifest` the runtime uses, so a
manifest Studio accepts is byte-identically accepted by the engine. That equivalence is enforced by a
shared conformance vector run from both sides (`src/conformance.test.ts` here,
`test/manifest-conformance.test.ts` in the core).

Studio owns the authoring workflow and the display layer; the core owns the truth.

> Build note: `pnpm run build` first builds the shared `@agrune/manifest` package (via the core's
> toolchain), then compiles Studio. The package must resolve at `../agrune/packages/manifest`.

## Install

```sh
pnpm install
pnpm run build
```

During local development you can run the compiled CLI directly:

```sh
node dist/cli.js --help
```

If linked globally, the binary name is:

```sh
agrune-studio --help
```

## Commands

Create an empty manifest:

```sh
agrune-studio init --out agrune.manifest.json
```

Validate manifest JSON shape and selector policy:

```sh
agrune-studio validate agrune.manifest.json
```

Add or update a target:

```sh
agrune-studio add-target agrune.manifest.json \
  --group login \
  --target submit \
  --action click \
  --role button \
  --text "Sign in" \
  --css 'button[type="submit"]'
```

Print a human-readable target table:

```sh
agrune-studio print agrune.manifest.json
```

## Scenarios (deterministic E2E)

A **scenario** is an ordered list of steps over **manifest refs** plus **declarative assertions** —
pure data, no code (SPEC §5). It replays identically every time; AI never enters execution. Studio
drives the `agrune` engine step-by-step (the importable `BrowserSession` API), capturing per-step
status, console/network, and optional screenshots.

```sh
agrune-studio scenario new --out login.scenario.json --name "login flow"
agrune-studio scenario validate login.scenario.json
agrune-studio scenario run login.scenario.json --url https://your.app
agrune-studio scenario run login.scenario.json --url https://your.app --artifacts ./shots --json
```

A step is either an **action** (`navigate`, `click`/`dblclick`/`contextmenu`/`hover`/`longpress`,
`fill`, `type`, `press`, `select`, `check`/`uncheck`, `wait`, `waitFor`) addressing a manifest
`ref` (a `targetId`, or a repeat key like `todo_items[key=a1].toggle`), or a declarative
**assertion** from the closed vocabulary:

`urlContains` · `urlEquals` · `titleContains` · `textPresent` · `textAbsent` · `targetVisible` ·
`targetHidden` · `targetCount` · `noConsoleErrors` · `networkStatus`.

The run exits non-zero on any failure (stop-on-first-failure). The target app must expose its
manifest on the page (`window.__agrune_manifest__`) so refs self-heal — a scenario addresses
declared refs, not raw selectors, so a redesign that keeps the manifest keeps the suite green.

## Auto-repair (AI ①)

When an app change drifts a ref so a scenario breaks, `scenario repair` heals it **without editing the
scenario**:

```sh
agrune-studio scenario repair login.scenario.json --url https://your.app --write-merged healed.manifest.json
```

It replays to the drift point, **proposes** a new selector for the drifted target, runs it through the
core's mechanical verify gate (`runRepair` → `verifyRepair`: the target must be declared, keep the
manifest valid, and actually resolve on the live page), then replays the whole scenario against the
healed map. Outcomes: `healed` (green again), `already-green`, or `needs-human`.

The propose step is the **only** AI seam (`RepairOptions.propose`); the default is a deterministic
heuristic (re-ground by the target's visible name). The gate is the safety boundary: **a wrong
proposal cannot resolve on the page, so it can never make a red scenario go green** — it is reported
as `needs-human`, never a false heal. AI proposes; the mechanical gate decides.

## Publishing + keys (closed publish, open consume)

Distributed artifacts (manifests, later scenarios) are **signed**; consumers verify with a pinned
key. The admin model is a **root-signed admin keyset** (Q3):

- The **root (owner) key** is the single trust anchor consumers pin. It signs ONLY the *keyset* (the
  list of active admins). Because it is used rarely, keep it **offline / in an HSM / secret manager**.
- **Admin keys** do the day-to-day signing. An admin key leak is contained: the root re-signs the
  keyset to **revoke just that admin** — consumers re-pin nothing.
- Each admin has its own key → per-signer attribution and scoped revocation.

```sh
# keys — private keys are written mode 0600; never commit them, never put them in the store
agrune-studio keygen --out root.pem --label root
agrune-studio keygen --out alice.pem --label alice   # prints the admin's public key + keyId

# admin model — root issues / revokes admins via a root-signed keyset
agrune-studio admin init   --root root.pem --out keyset.json
agrune-studio admin grant  --root root.pem --keyset keyset.json --admin-pub <alice-pubkey> --label alice
agrune-studio admin list   --root root.pem --keyset keyset.json
agrune-studio admin revoke --root root.pem --keyset keyset.json --key-id <alice-keyId>

# sign (with an admin key) → publish to a dir store → verify the runtime trust gate
agrune-studio sign app.manifest.json --key alice.pem --origin example.test --out env.json
agrune-studio publish env.json --store ./store --origin example.test
agrune-studio verify env.json --root root.pem --keyset keyset.json   # ACCEPT / REJECT
```

`verify` runs the exact gate the runtime applies: the keyset must verify under the pinned root, and
the manifest must be signed by the root or an **active** admin. Revoke an admin and the same envelope
is rejected (`untrusted-signer`); forge a keyset with a non-root key and it is rejected
(`untrusted-keyset`). Signing/verification live in the core (`@agrune/manifest` is the schema truth;
`agrune` is the sign/verify truth) — Studio never re-implements them.

> **Key storage:** root key offline/HSM (used only for grant/revoke); admin keys in a secret
> manager; **never** store any private key in the artifact store or the repo.

## Monkey testing (AI ②)

A **bounded** explorer that only ever actuates targets the manifest declares (the §8.8 strict-mode
cage, enforced by construction — it enumerates targets from the snapshot), hunting for the cheap,
reliable oracle class: console errors, uncaught page errors, network failures, crashes.

```sh
agrune-studio monkey https://your.app --steps 30 --seed 1 --out candidate.scenario.json
```

Exploration is driven by a **seeded PRNG** with a coverage-first policy, so `(url, seed)` always
produces the same trail — a finding is reproducible. When the oracle fires, the action sequence that
triggered it is captured as a **candidate scenario** (the trail + a `noConsoleErrors` guard). Replay
the candidate to reproduce the bug; adopt it as a regression test. `monkey` exits non-zero when it
finds something, so CI can gate on it.

## Scenario discovery (AI ③)

The AI walks the app and **proposes uncovered flows**; a human **reviews and adopts** one into a
deterministic scenario (proposal = AI, adoption = human). Proposals are deduped against the existing
suite's coverage and the coverage delta is measured.

```sh
agrune-studio discover https://your.app --scenarios ./scenarios          # show coverage + proposals
agrune-studio discover https://your.app --scenarios ./scenarios --adopt 0 --out new.scenario.json
```

It loads the suite from `--scenarios <dir>`, computes coverage against the app's declared targets,
proposes one flow per group with uncovered actionable targets, and reports
`covered/declared → projected if all adopted`. The default proposer is a deterministic heuristic
(fill the group's inputs, click its primary action, guard with `noConsoleErrors`); it is the only AI
seam (`DiscoveryOptions.propose`) and is pluggable for an LLM. Adopting writes the proposal verbatim
as a scenario file — a real, replayable, green test you then refine.

## Site packs + catalog (Phase 6)

A **site pack** = a manifest (the map) + its scenarios (the suite), pinned together and **signed as one
envelope**. A consumer pulls a pack and can QA the app immediately. Publish is closed (admin-signed);
consume is open (anyone with the pinned root).

```sh
# author + publish (closed) — admin-signed
agrune-studio pack create --manifest app.manifest.json --scenarios ./scenarios \
  --name "Example app" --version 1.0.0 --origin example.test --key alice.pem --out pack.json
agrune-studio pack publish pack.json --store ./store          # writes the pack + updates index.json

# discover + consume (open) — verified under the pinned root + keyset
agrune-studio catalog list    --store ./store --root root.pem --keyset keyset.json
agrune-studio catalog install example.test --store ./store --root root.pem --keyset keyset.json --dest ./packs
agrune-studio catalog run     example.test --dest ./packs --url https://your.app
```

`catalog list` shows each app/version with **verified** provenance (signer keyId, publish time,
scenario count) — a pack that fails the trust gate (wrong signer, revoked admin, tampered bytes) shows
`✗`. `catalog install` re-verifies under the pinned root + keyset and **pins** the manifest, scenarios,
and a `pinned.json` (version + contentHash + signer); a revoked signer blocks install. `catalog run`
replays the pinned scenarios against the live app using the **pinned manifest** as the resolver
override, so the suite stands on the map the pack shipped.

Version history is the set of versions in the store/index; **rollback** is consumer-side
(`catalog install --version <older>`) or publisher-side (`git revert` on a git-backed store). A
graphical catalog UI over this signed store is the natural next step; the CLI is the current surface.

## Validation Rules

These are enforced by `@agrune/manifest` (not by Studio); listed here for reference only.

- `version` must be `3`.
- `groups` must be an array.
- Each group needs `groupId` and `targets`.
- Each target needs `targetId`, at least one `actionKinds` entry, and a `selector`.
- A selector must include at least one of `role`, `text`, `testId`, `attr`, or `css`.
- `sensitive: false` is rejected. Omit the field or use `sensitive: true`.
- Hash-like CSS classes such as `.a1b2c3d4` are rejected in `css` and `attr`.
- `:nth-child(...)` is rejected in `css` and `attr`.

## Test

```sh
pnpm test
```
