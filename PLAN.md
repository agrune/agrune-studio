# Agrune Studio — PLAN

Execution plan derived from `SPEC.md`. SPEC = the "why/what" (identity, model, trust, boundary);
this PLAN = the "what to do" (decisions, tracks, phased tasks, done-criteria). Keep them in sync: if
a task changes the design, update SPEC; if the design changes, re-derive the affected tasks here.

---

## 0. One-line goal

**Studio = a self-healing E2E QA automation platform on top of the `agrune` engine.** Deterministic
scenarios for execution; AI for repair / monkey / discovery *around* execution; manifests + scenarios
distributed as signed **site packs** so people can pull a pack and QA an app immediately.

---

## 1. Decisions to lock before building (the SPEC §10 open questions)

| # | Decision | Recommended default | Status | Blocks |
|---|---|---|---|---|
| Q1 | Manifest truth package topology | **Re-cut `@agrune/manifest` as the shared module** (core + Studio + demo import it) | ✅ confirmed (re-cut) | Phase 0 |
| Q2 | Scenario format | **Typed JSON/YAML step list** (portable, diffable); recorder later | ✅ confirmed (typed JSON step list, `agrune.scenario/v1`) | Phase 1 |
| Q3 | Admin key scheme | flat pinned-key set vs. **root-signed chain** (scalable/revocable) | ✅ confirmed (**root-signed admin keyset** — pin root only; root signs the active-admin keyset, used rarely → offline; admin leak = revoke without re-pinning) | Phase 3 |
| Q4 | Assertion vocabulary (**security boundary**) | **closed declarative enum, NO arbitrary code** | 🔒 forced by §5 — confirmed (10-verb closed enum) | Phase 1 + 6 |
| Q5 | Pack granularity / versioning | manifest + scenarios as one pinned pack vs. scenario refs manifest version | ✅ confirmed (scenario carries the manifest `schemaVersion` it targets; pinned site-pack in Phase 6) | Phase 1 + 6 |

> Q4 is not really open — security forces "declarative enum." The rest need a call before their phase.
> Recommended set: Q1 re-cut · Q2 typed step list · Q3 root-signed chain · Q5 pinned pack.
> **Locked (2026-06-27):** Q1 re-cut · Q2 typed step list · Q3 root-signed admin keyset (a 1-level
> root→keyset chain — root used only to (re)sign the active-admin set, so it stays offline; an admin
> compromise is revoked without consumers re-pinning) · Q4 10-verb closed enum · Q5 scenario carries
> its target `schemaVersion`.

---

## 2. Invariants (must hold across every phase)

- **Truth lives in the core; Studio imports it.** Never re-implement schema/validator/trust gates in
  Studio (a duplicate validator → "OK in Studio, fails at runtime").
- **AI never enters scenario execution.** Execution is deterministic + repeatable. AI does only the
  three meta-jobs (repair / monkey / discovery), all *outside* a run.
- **Distributed artifacts are pure data + signed.** Scenarios carry no arbitrary code (declarative
  assertions only); manifests + scenarios are admin-signed, consumer-verified via pinned key.
- **Publish closed, consume open.** Only owner + owner-authorized admins sign; anyone consumes.

---

## 3. Tracks

Work splits across two repos. The **Core track** is prerequisite API surfacing in the `agrune` repo;
the **Studio track** builds on it here.

### Core track (in `agrune/` — exposes seams Studio depends on)
- [x] **C0** Re-cut manifest truth as the shared `@agrune/manifest` (schema v3, validator, selector
  policy, `keyFrom` gate) — single source for core + Studio + demo. *(Q1)* — `packages/manifest`;
  core `src/manifest.ts` is now a re-export shim.
- [x] **C1** Export the resolver + action surface + run-result signals (changed-bit, console,
  network) as importable API (`src/api.ts` + package `exports` + dts). *(Phase 1)*
- [x] **C2** Export `runRepair` / `verifyRepair` / drift report (added to `src/api.ts`). *(Phase 2)*
- [x] **C3** Export `signManifest` / `verifyEnvelope` / `publishToDir` + `generateKeyPair` + the
  root-signed keyset (`src/keyset.ts`). *(Phase 3)*
- [x] **C4** Apply the §12 signed envelope to **scenarios/packs** — generic `signPayload` /
  `verifyPayloadEnvelope` / `verifyPayloadWithKeyset` (`src/pack-store.ts` + `src/keyset.ts`). *(Phase 6)*
- [x] **C5** Store **index** endpoint — `scanStore` / `writeStoreIndex` / `readStoreIndex` enumerate
  published packs (`src/pack-store.ts`). *(Phase 6)*

### Studio track (here)
Phased below.

---

## 4. Phased tasks (risk-ordered)

### Phase 0 — Unify the manifest truth  ✅ DONE  (was ⛔ blocks everything)
Drift is live: core uses `agrune/src/manifest.ts` (v3, June 2026); Studio imports
`@agrune/manifest@0.4.1` (older). Unify first.
- [ ] Decide Q1 (recommend re-cut).
- [ ] **C0** done in core track.
- [ ] Studio: drop the `@agrune/manifest@0.4.1` pin; consume the shared module the core ships.
- [ ] Refresh README (it claims "no import" but already imports — make it honest).
- [ ] Re-run `src/validator.test.ts` against the current schema; fix divergences.
- [ ] **Done:** a manifest valid in Studio is byte-identically accepted by the runtime — proven by a
  shared conformance test runnable from both packages.

### Phase 1 — Deterministic scenario engine  ✅ DONE  (the QA base; standalone value, ship first)
- [ ] Decide Q2 (scenario format) + Q4 (assertion enum) + Q5 (does a scenario carry its manifest version?).
- [ ] **C1** done in core track.
- [ ] Define the scenario schema: ordered steps over **manifest refs** + declarative assertions
  (Q4 enum) + the manifest version it targets (Q5).
- [ ] Build the runner: drive the core engine step-by-step; capture screenshots / console / network
  per step; deterministic pass/fail.
- [ ] Report output (per-step status, failure artifacts).
- [ ] Studio commands: `scenario new` / `scenario run <file> --url <app>` / report view.
- [ ] Tests: a sample scenario replays green on a stable app; flips red on an intentional break.
- [ ] **Done:** author a scenario, replay it against a real app, get a deterministic pass/fail report.

### Phase 2 — AI ① auto-repair  ✅ DONE  (connect what's already built)
- [ ] **C2** done in core track.
- [ ] On a step whose ref drifted, run drift → propose → `verifyRepair` → publish; re-run the scenario.
- [ ] Surface "healed" vs "needs human" outcomes; the `propose` seam wires an agent/LLM.
- [ ] Guard: a wrong auto-fix can never go green (the verify gate is mechanical).
- [ ] **Done:** a scenario broken by an app change goes green again with no hand-editing.

### Phase 3 — Publishing + keys  ✅ DONE
- [ ] Decide Q3 (admin key scheme).
- [ ] **C3** done in core track.
- [ ] Studio commands: `keygen` (ed25519), `sign`, `publish` (to dir store / git PR).
- [ ] Key & admin model: root key + issue/rotate/revoke admin keys; documented key storage
  (Secret/HSM, never the store).
- [ ] **Done:** owner produces a signed manifest the runtime accepts end-to-end; can grant/revoke an admin.

### Phase 4 — AI ② monkey testing  ✅ DONE
- [ ] Bounded explorer over declared targets under strict mode (§8.8) — no off-manifest actuation.
- [ ] Oracle v1: crash / console error / network failure / unhandled exception (cheap, reliable).
- [ ] Repro capture: the step sequence that triggered a finding → becomes a candidate scenario.
- [ ] **Done:** a monkey run surfaces a reproducible crash/error as a candidate scenario.

### Phase 5 — AI ③ scenario discovery  ✅ DONE
- [ ] AI walks the app and proposes uncovered flows.
- [ ] Human reviews/adopts a proposal into a deterministic scenario (proposal = AI, adoption = human).
- [ ] Dedup proposals against existing coverage; report coverage delta.
- [ ] **Done:** AI-proposed flows become reviewed, deterministic scenarios with measured coverage gain.

### Phase 6 — Catalog of site packs  ✅ DONE  (curated 1st-party distribution)
- [ ] Decide Q5 pack granularity if not already.
- [ ] **C4** + **C5** done in core track.
- [ ] Distribute **site packs = manifest (map) + scenarios (suite)**, both signed.
- [ ] Front-end over the signed store: list apps, versions, signer/provenance, install/consume,
  version history, one-click rollback (git revert). Publish closed; consume open.
- [ ] **Done:** a consumer discovers + pins a site pack and runs its scenarios immediately; an admin
  publishes a new version that shows with provenance.

---

## 5. Current state

- **Studio MVP exists:** `init` / `validate` / `add-target` / `print` (`src/{cli,types,validator,io,table}.ts`),
  already importing `@agrune/manifest` (README stale).
- **Core has the resilience engine built:** manifest resolve, drift (§8.6), signed store + repair
  (§12), strict/manifest-only (§8.8) — all to be surfaced via the Core track and re-contextualized as
  the QA stability engine.

---

## 6. Non-goals (now)

- AI inside scenario execution (would break determinism).
- Public UGC market / reputation / malware review (publishing is closed).
- Arbitrary code in scenarios (steps or assertions) — pure data only.
- Semantic-correctness oracles for monkey testing beyond the crash/error class (Phase 4 v1).
- Real-time collaborative editing; non-QA artifacts.

---

## 7. Critical path

```
Q1 ─▶ C0 ─▶ Phase 0 ─▶ C1 + Q2/Q4/Q5 ─▶ Phase 1 ─▶ C2 ─▶ Phase 2
                                              │
                                              └▶ (parallel-able) C3/Q3 ─▶ Phase 3
Phase 1 ─▶ Phase 4 (monkey) ─▶ Phase 5 (discovery)
Phase 3 + C4 + C5 ─▶ Phase 6 (catalog)
```

Phase 0 → 1 → 2 is the spine (unify, deterministic engine, then the cheap-and-differentiating
auto-repair). Phases 3–6 layer publishing, AI discovery, and distribution on top.
