# Agrune Studio — SPEC & Roadmap

> Status: draft (2026-06-27). Studio is the **human-facing surface of Agrune**, and its product is a
> **self-healing E2E QA automation platform** built on the `agrune` engine. This document defines the
> model, the boundary against the `agrune` core, and a risk-ordered roadmap.

---

## 1. Identity

**Studio is a self-healing E2E QA automation platform that uses the `agrune` core as its execution
engine.**

The machine/human lens still holds and settles every boundary question:

> Used by an **agent / the runtime** → **core** (`agrune`). Used by a **person** (QA author,
> operator, admin) → **Studio**.

The product thesis, in one line:

> **Keep classic deterministic E2E QA (author scenarios once, replay them, assert) as the trusted
> base — and use AI NOT to run the tests, but to automate the work AROUND the tests: heal them,
> hunt for bugs, and grow coverage.**

This is the key design decision (made 2026-06-27): **AI does not enter scenario execution.** A
scenario runs the same way every time (repeatable — the whole point of QA). AI lives *outside*
execution, doing three meta-jobs only.

---

## 2. The model — deterministic execution + 3 AI augmentations

| Layer | What | AI? |
|---|---|---|
| **Execution** | pre-authored deterministic scenarios, replayed identically | ❌ pure |
| **Target layer** | scenarios address **manifest refs** (not raw selectors) → self-healing | — |
| **AI ① auto-repair** | when a scenario breaks on drift, AI proposes a fix → core gate verifies → publish | ✅ |
| **AI ② monkey testing** | AI explores within the declared surface to surface bugs | ✅ |
| **AI ③ scenario discovery** | AI walks the app and proposes uncovered flows for a human to adopt | ✅ |

**Why this shape is right (objective).** Putting AI *inside* execution makes runs non-deterministic
(flaky) — fatal for QA. Putting AI *outside* execution preserves determinism while capturing AI's
real value (maintenance + discovery). The base is boring and reliable; the AI is where the leverage
is, and it can never silently change what a green test means.

**Differentiation.** Classic E2E's core pain is "the app changes → selectors break → suite
collapses (maintenance hell)." Agrune QA stands on a **self-healing manifest target layer**: a
scenario addresses declared refs, drift is detected (§8.6), and AI ① repairs through the verified
store loop (§12). The edge over mabl/Testim/Cypress is not "AI clicks for you" — it is **the app
declares a stable, self-healing target layer the tests stand on.**

---

## 3. Manifests are infrastructure here

Everything already built in the core is re-contextualized as the **QA stability engine**:

- **manifest ref** = a scenario step's stable address (survives redesigns where a raw selector dies).
- **drift detection (§8.6)** = "this scenario is about to break" early-warning.
- **store + repair (§12)** = AI ① auto-repair's verify-before-publish backbone.
- **strict / manifest-only (§8.8)** = the cage that keeps AI ② monkey testing inside the declared
  surface (no off-manifest actuation, no exfil) — turning a risky "AI clicks randomly" into a
  bounded, auditable explorer.

So Studio doesn't reinvent QA stability — it **surfaces the core's resilience as a QA product.**

---

## 4. The three AI augmentations — value, difficulty, status

**① Auto-repair — ★ mostly built.** Drift detection, the `verifyRepair` gate, and the signed store
already exist. Wire them to a broken scenario's failing ref. The invariant "propose → verify →
publish, never guess → publish" means a wrong auto-fix can never poison a scenario. *Fastest path,
core differentiator.*

**② Monkey testing — attractive, oracle is the crux.** AI pokes manifest targets to find bugs;
strict mode (§8.8) bounds it. Hard part is the **oracle** ("what counts as a bug?"): crashes /
console errors / network failures / unhandled exceptions are auto-detectable; "logically wrong
behavior" needs assertions or human judgment. MVP = crash/error oracle first; semantic oracles
later.

**③ Scenario discovery — coverage growth, needs human review.** AI walks the app and proposes
untested flows; a human approves → it becomes a deterministic scenario. Proposal is AI; adoption is
human (same pattern as the repair console). Risk = proposal quality / dedup.

---

## 5. Trust & publishing model (curated, closed-publish)

Shared with core §8.8/§12. Publishing is **closed** (owner + owner-authorized admins, private key);
consumption is **open** (anyone, pinned public key).

**Two distributed artifacts, one trust model.** Studio distributes BOTH:
- **manifests** — the app's self-healing target map ("how to drive this app").
- **scenarios** — verified QA suites over those targets ("how this app is tested").

Both are signed by an admin and verified by consumers via the pinned key — the same §12 envelope.
A consumer pulls a **site pack** = a manifest (map) + its scenarios (suite), so they can QA the app
*immediately*, not just automate it. (This is the "site pack" concept from the original roadmap.)

**⚠️ Scenarios are a trust surface too — keep them PURE DATA.** A distributed scenario executes in
the consumer's environment. If a step or assertion could carry an arbitrary JS expression, it would
be a `keyFrom`-class RCE (the exact injection the manifest already guards). Defense is two-layer and
the second is the load-bearing one:
- (a) scenarios are **signed** (admin-only publish), same as manifests; and
- (b) **assertions/steps are a declarative enum, NEVER arbitrary code** (text-present, target
  visible/hidden, URL match, count, network status, …). This makes a scenario pure data, so the
  signature alone makes distribution fully safe. *This elevates the "assertion vocabulary" question
  (§10) from a feature choice to a security boundary — it must be declarative.*

**Versioning.** A scenario stands on a specific manifest; a pack pins compatible versions (or a
scenario references the manifest version it was authored against) so a consumed scenario can't run
against an incompatible map.

Because publishing is closed, the catalog needs **no UGC moderation / reputation / malware review**
(the two biggest market risks — chicken-egg and malicious `keyFrom` — don't arise). What it needs is
a **key & admin model** (issue / rotate / revoke), since the residual threat is admin key compromise
(core threat ⑥). Admins = additional signing keys; root issues/revokes them.

---

## 6. Boundary — Studio vs Core

| Concern | Owner |
|---|---|
| browser execution engine, resolve, drift detect, store fetch+verify, strict gate | **Core** |
| manifest schema / validator / selector policy / signature & repair **verification** | **Core** (single source of truth) |
| **scenario authoring / management / runner / assertions / reports** | **Studio** |
| AI ①②③ orchestration (repair / monkey / discovery) | **Studio** (over core seams) |
| keygen / sign / publish + key & admin model | **Studio** |
| catalog / discovery front-end | **Studio** |

Studio imports the core's manifest truth and verification gates; it never re-implements them.

---

## 7. Current state & the live risk

- **Studio MVP:** `init` / `validate` / `add-target` / `print` (`src/{cli,types,validator,io,table}.ts`),
  already importing `@agrune/manifest` (README is stale).
- **⚠️ Truth has forked — Phase 0 fixes it.** Core uses its own `src/manifest.ts` (schema v3,
  June 2026); Studio imports `@agrune/manifest@0.4.1` (older). A scenario authored against Studio's
  schema could be rejected by the runtime. Unify before building on top.

---

## 8. Roadmap (risk-ordered)

### Phase 0 — Unify the manifest truth (blocks all)
- Studio consumes the SAME manifest module the core ships (not `@agrune/manifest@0.4.1`).
- Core dep: publish the live truth as one shared module (`@agrune/manifest` re-cut from
  `agrune/src/manifest.ts`, or a workspace dep). One schema/validator/policy for core + Studio + demo.
- Done: a manifest valid in Studio is byte-identically accepted by the runtime (shared conformance test).

### Phase 1 — Deterministic scenario engine (the QA base — ship this first, it has standalone value)
- Studio: define a scenario format (ordered steps over manifest refs + assertions), a runner that
  drives the core engine step-by-step, pass/fail with screenshots/console/network captured, a report.
- Core dep: expose the resolver/action surface + run-result signals (changed-bit, console, network)
  as importable API (today inside the `agrune` package).
- Done: author a scenario, replay it against a real app, get a deterministic pass/fail report.

### Phase 2 — AI ① auto-repair (connect what's built)
- Studio: on a scenario step whose ref drifted, run the repair loop (drift → propose → `verifyRepair`
  → publish) and re-run the scenario; surface "healed" vs "needs human."
- Core dep: `runRepair` / `verifyRepair` / drift report exposed.
- Done: a scenario that broke on an app change goes green again without hand-editing.

### Phase 3 — Publishing + keys
- Studio: `keygen`, `sign`, `publish`; key & admin model (root + issue/rotate/revoke admin keys);
  documented key storage.
- Core dep: `signManifest` / `verifyEnvelope` / `publishToDir` exposed; `generateKeyPair` helper.
- Done: owner produces a signed manifest the runtime accepts end-to-end; can grant/revoke an admin.

### Phase 4 — AI ② monkey testing
- Studio: bounded explorer over declared targets under strict mode; crash/console/network/exception
  oracle; repro capture (the step sequence that triggered it) so a finding becomes a scenario.
- Core dep: strict mode (built §8.8) + event/console/network capture.
- Done: a monkey run surfaces a reproducible crash/error as a candidate scenario.

### Phase 5 — AI ③ scenario discovery
- Studio: AI walks the app, proposes uncovered flows; human reviews/adopts into deterministic
  scenarios; dedup against existing coverage.
- Done: AI-proposed flows become reviewed, deterministic scenarios with measured coverage delta.

### Phase 6 — Catalog of site packs (curated 1st-party distribution)
- Studio: discoverable front-end over the signed store distributing **site packs = manifest (map) +
  scenarios (suite)**, both signed. List apps, versions, signer/provenance, install/consume, version
  history, one-click rollback (git revert). Publish closed (owner + admins); consume open.
- Core dep: a store **index** endpoint (enumerate available packs) + the §12 envelope applied to
  scenarios (same sign/verify path as manifests).
- Done: a consumer discovers + pins a site pack and runs its scenarios immediately; an admin
  publishes a new version that shows with provenance.

---

## 9. Non-goals (now)

- **AI inside scenario execution** (would make runs non-deterministic — the model deliberately keeps
  AI outside execution).
- **Public UGC market / reputation / malware review** (publishing is closed; unnecessary, and would
  re-introduce removed risks). A future open model would need `keyFrom` static analysis + curation —
  a separate SPEC.
- **Arbitrary code in scenarios** (steps or assertions). Distributed scenarios must stay pure data so
  the signature alone makes them safe; assertions are a fixed declarative vocabulary, not expressions.
- **Semantic correctness oracles for monkey testing** beyond crash/error class (Phase 4 starts with
  the cheap, reliable oracle).
- **Real-time collaborative editing; non-QA artifacts.**

---

## 10. Open questions

1. **Package topology** (Phase 0): re-cut `@agrune/manifest` as shared truth (clean, prior decision)
   vs. Studio depending on the `agrune` package directly (fewer parts). Recommend re-cut.
2. **Scenario format:** a typed JSON/YAML step list (portable, diffable, the prior-decision style)
   vs. a recorder that captures steps from a live session vs. both. Decide before Phase 1.
3. **Admin key-chain:** flat pinned-key set vs. root-signed chain (more scalable/revocable).
   **DECIDED (2026-06-27): root-signed admin keyset.** Consumers pin ONLY the root (owner) public
   key. The root signs a *keyset* — the active-admin public keys + a revoked list — and is used only
   to (re)sign it (grant/revoke), so it lives offline/HSM with minimal exposure. Admins do the
   frequent signing; an admin-key compromise is contained by the root re-signing the keyset to revoke
   that one admin, with NO consumer re-pin. The runtime gate (`verifyManifestWithKeyset`) verifies the
   keyset under the pinned root, then accepts a manifest signed by the root or any active admin —
   composing the existing single-key `verifyEnvelope`, so there is no weaker path. Per-admin keys give
   attribution + scoped revocation; a flat pinned set was rejected because revocation would force every
   consumer to re-pin.
4. **Assertion vocabulary (now a SECURITY boundary, §5):** the declarative set a step may assert
   (text present, target visible/hidden, URL match, count, network status, …). Must be a closed enum,
   NOT arbitrary expressions, so distributed scenarios stay pure data. Decide the exact set before
   Phase 1 — it defines both Phase 1's depth and what is safe to distribute in Phase 6.
5. **Pack granularity / versioning:** distribute a manifest and its scenarios as one pinned pack, vs.
   scenarios that independently reference a manifest version. Decide before Phase 6 (affects the
   scenario format in Phase 1 — whether a scenario carries the manifest version it targets).
