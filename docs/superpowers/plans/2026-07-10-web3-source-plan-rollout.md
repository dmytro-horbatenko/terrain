# Web3 Source-Plan Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent invented legacy source evidence, curate explicit bounded source plans for every reviewable Web3 leaf, deploy that content, then safely reset and re-import one production user's Web3 course.

**Architecture:** Prepared content remains the source of truth. A strict legacy guard stops first-exposure sessions and imports when the stored topic has no source plan. The existing Web3 loader validates the shared source-plan schema plus course-specific quality rules. Content is curated phase-by-phase and deployed before one production user's Web3 topics are transactionally deleted and re-imported from the prepared course; there is no reusable backfill subsystem.

**Tech Stack:** JSON learning-os v2 content, Node.js 24 standard library, `@terrain/types` Zod schemas, existing Nest Topics API.

## Global Constraints

- Core Tasks 1–8 are complete. Finish the legacy guard before curation, then close the strict local fail/pass/apply/rollback smoke left in Core Task 9 before deployment.
- Every `type: 'pattern'` Web3 topic has `sourcePlan.policy = 'required'` or an explicit `policy = 'none'` rationale.
- Curated candidates must be compared; requirement options are alternatives for the same purpose, while separate requirements are complementary.
- Every source uses an exact bounded scope and explains its distinct contribution.
- Prefer primary/canonical technical sources; use pedagogical sources for explanation and worked examples.
- Verify fast-changing Web3 material against current official sources during curation.
- A freshness-sensitive option includes both `verifiedAt` and `recheckAfterDays`; stable sources include neither.
- Remove legacy `Resources:` prose from every Web3 description after the leaf plans are authored; keep concept prose in `description` and Build/Done-when in `aiContext`.
- Split files rather than weakening the existing 40-topic/90KB limits.
- Add no dependencies.
- The current corpus has 360 reviewable Web3 leaves across 16 content files; every leaf is researched individually, not mechanically converted from its legacy URL.
- Each curation task records a phase report under `.superpowers/sdd/source-grounded/` listing every leaf, candidates compared, selected sources/roles, substitutions, rejected stale/dead/duplicated candidates, URL-check evidence, and review result.
- After Task 1A, each curation subagent owns exactly one content file plus its uniquely named report; up to three independent files may be researched/edited in parallel. Every file receives its own spec-and-quality review before acceptance, and curation agents never edit the shared manifest.
- Do not reset production until the curated content and legacy guard are deployed and the deployed course payload is verified.
- The production mutation is deliberately one-user/one-course: delete only the exact user's Web3 data and Web3 `CourseImport` marker in one guarded SQL transaction, preserving DSA, other domains, and every other user.
- Never execute production deletion from this local session. Produce exact commands for the operator, stop on unexpected counts, and leave COMMIT as an explicit human action.
- Do not execute a commit step unless the user explicitly authorizes commits.

---

## Source selection rubric used by every curation task

For each leaf topic:

1. Read its concept, Build, Done-when, prerequisites, and existing card.
2. Identify the minimum distinct source roles needed:
   - conceptual explanation;
   - canonical precision/current behavior;
   - worked implementation or adversarial example.
3. Search at least two credible candidates for each non-canonical role. A single
   official specification may stand alone when it fully covers a narrow fact.
4. Reject stale, deprecated, unmaintained, paywalled-only, bare-homepage, or
   duplicated candidates.
5. Create one requirement per required role. Put equivalent media alternatives
   inside that requirement; never put a canonical reference and tutorial in the
   same alternatives list.
6. Bound `scope` to a named section, chapter, lesson, timestamp range, or an
   explicitly short entire page.
7. Estimate active consumption time, not total course length.
8. Write `why` so a later maintainer can tell why this source beats the rejected
   candidates and what it contributes beyond the other requirements.
9. Use the learner defaults when alternatives are otherwise equal: English,
   documentation/text before video for precision, free before paid, and a total
   normal intake budget near 45 minutes.
10. Run structural and live URL validation for the edited phase before review.
11. Record the candidate comparison and rejection trail in the phase report; a URL appearing in the final JSON is not by itself evidence that alternatives were researched.

---

### Task 0: Stop legacy first-exposure sessions and prohibit invented evidence

**Files:**
- Modify: `apps/api/src/sessions/export-generator.service.ts`
- Test: `apps/api/src/sessions/export-generator.service.spec.ts`
- Modify: `apps/api/src/sessions/session-conduct.ts`
- Test: `apps/api/src/sessions/session-conduct.spec.ts`
- Modify: `apps/api/src/sessions/output-contract.ts`
- Test: `apps/api/src/sessions/output-contract.spec.ts`
- Modify: `apps/api/src/import/import.service.ts`
- Test: `apps/api/src/import/import.service.spec.ts`

**Interfaces:**
- Produces an explicit `LEGACY FIRST EXPOSURE BLOCKED` export state for planned topics with `sourcePlan = null`.
- Keeps active/mastered legacy topics in labelled compatibility mode without formal source tracking.
- Makes Import Preview block activation of a planned legacy topic and reject any invented requirement/source IDs.

- [ ] **Step 1: Write exact failing export and conduct tests**

For a planned focus with `sourcePlan = null`, assert the export contains all of:

```text
LEGACY FIRST EXPOSURE BLOCKED — no source plan is stored for this topic.
STOP: this topic must be curated before strict source-grounded learning can proceed.
Do not invent requirementId or sourceId.
Emit no sourceEvidence for this topic and do not add it to studiedTopics.
```

For an active focus with `sourcePlan = null`, assert it instead contains:

```text
LEGACY COMPATIBILITY MODE — no source plan is stored for this previously studied topic.
Do not invent requirementId or sourceId, and emit no sourceEvidence for this topic.
```

Assert `LEARN_CONDUCT` tells the model to stop on `LEGACY FIRST EXPOSURE BLOCKED`, and `OUTPUT_CONTRACT` says IDs must be copied exactly from stored SOURCE PLAN entries and that no stored requirement means no evidence entry.

- [ ] **Step 2: Write failing Import Preview regression tests**

Add separate cases proving:

- a planned existing legacy topic in `studiedTopics` yields `reason: 'missing-plan'`, `blocking: true`, and `applicable: false`;
- an in-batch studied topic without `sourcePlan` is blocked the same way;
- an active/mastered legacy topic with no source evidence yields labelled non-blocking compatibility warning and remains applicable;
- any evidence naming an unstored legacy `requirementId` is `unknown-requirement` and blocking;
- no apply transaction begins for the blocked planned-legacy case.

- [ ] **Step 3: Run the focused tests and confirm RED**

```bash
yarn workspace @terrain/api test --runInBand src/sessions/export-generator.service.spec.ts src/sessions/session-conduct.spec.ts src/sessions/output-contract.spec.ts src/import/import.service.spec.ts
```

Expected: the planned-legacy export and Import Preview assertions fail under the current warning-only behavior.

- [ ] **Step 4: Implement the minimum shared-state distinction**

In `sourcePlan()`, branch null plans by topic status. Planned means the exact blocking copy above; active/mastered means compatibility copy. In the import activation walk, make `missing-plan` blocking when `currentStatus` is `planned` or null (an in-batch topic), and non-blocking only for already-studied active/mastered topics.

Keep unknown requirement/source handling unchanged: it already rejects invented IDs. Add only the conduct/output prohibitions needed to prevent the prescribed session from producing them.

- [ ] **Step 5: Run focused tests and builds**

```bash
yarn workspace @terrain/api test --runInBand src/sessions/export-generator.service.spec.ts src/sessions/session-conduct.spec.ts src/sessions/output-contract.spec.ts src/import/import.service.spec.ts
yarn workspace @terrain/api build
yarn workspace @terrain/web build
```

Expected: all pass; Import Preview cannot accept a prescribed first-exposure legacy session.

- [ ] **Step 6: Per-task review**

Review the scoped diff for both spec compliance and quality. In particular, confirm the guard lives at the shared export/import seams, compatibility mode never emits formal evidence, and existing curated topics are unchanged.

---

### Task 1: Upgrade Web3 content validation for source plans

**Files:**
- Modify: `scripts/lib/web3-content.mjs`
- Modify: `scripts/validate-web3-content.mjs`
- Create: `scripts/lib/web3-content.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `learningOsV2Schema` and per-topic `sourcePlan` from the core plan.
- Produces: `sourcePlanErrors(topic, file)`, source-plan URL enumeration,
  phase-scoped `--source-prefix NN` validation, and `yarn web3:content:test`.

- [ ] **Step 1: Write a failing Node test with valid and invalid leaves**

Use `node:test` and `node:assert/strict`; no test dependency:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { sourcePlanErrors } from './web3-content.mjs';

const valid = {
  title: 'Test leaf',
  type: 'pattern',
  sourcePlan: {
    policy: 'required',
    requirements: [{
      id: 'canonical',
      purpose: 'Verify the exact protocol semantics',
      requiredWhen: 'first_exposure',
      options: [{
        id: 'official',
        title: 'Official docs',
        url: 'https://example.com/docs',
        format: 'documentation',
        scope: 'Section 2',
        estimatedMinutes: 10,
        why: 'Defines the normative behavior and edge cases',
      }],
    }],
  },
};

test('requires explicit source policy on Web3 leaves', () => {
  assert.deepEqual(sourcePlanErrors(valid, '01.json'), []);
  assert.match(sourcePlanErrors({ ...valid, sourcePlan: undefined }, '01.json')[0], /sourcePlan/);
});
```

Also assert:

- `policy: none` needs a concrete rationale of at least 30 characters;
- requirement and option IDs are unique;
- every required group has at least one option;
- every option URL uses HTTP(S);
- `scope` is accepted only when it names a section/chapter/lesson/page range/timestamp range or an explicitly short entire page/article;
- a homepage-like or generic `scope` such as `Docs`, `Homepage`, or `Entire site` fails;
- `purpose` and `why` are specific (at least 20 and 30 characters respectively, not generic labels such as `Canonical reference`);
- freshness fields appear as a pair;
- `allUrls()` returns required-option and optional-source URLs.

- [ ] **Step 2: Run the Node test and confirm RED**

Run: `node --test scripts/lib/web3-content.test.mjs`

Expected: FAIL because `sourcePlanErrors` is not exported.

- [ ] **Step 3: Replace the old leaf Resources rule**

Remove `URL_RE` and the old `description has no Resources: URL` rule. Export a course-specific validator that supplements the shared Zod schema:

```js
export function sourcePlanErrors(topic, file) {
  if (topic.type !== 'pattern') return [];
  if (!topic.sourcePlan) return [`${file}: leaf "${topic.title}" has no sourcePlan`];
  // Validate concrete rationale/purpose/why, HTTP(S), and bounded scope here.
  // The shared Zod schema remains the canonical shape/ID/freshness validator.
  return sourceQualityErrors(topic.sourcePlan, file, topic.title);
}
```

Independently reject `/resources:/i` in every topic description, including non-reviewable concept/chapter nodes. Apply this migration rule to the same files selected by `sourcePrefixes` during phased rollout, and to every file when no prefix is supplied. Those structural descriptions are context, not a second untracked source channel.

Use one small bounded-scope predicate shared by validator and tests. Accept named sections, chapters, lessons, parts, page ranges, `§` references, timestamp ranges, and `Entire article/page/README/EIP/ERC (<N> min)`. Reject bare homepages/sites and vague whole-document labels without an explicit short active-consumption bound. Do not add a heuristic scoring system.

The shared Zod schema handles plan structure. Extend
`structuralErrors(files, { sourcePrefixes = [] } = {})`: enforce
`sourcePlanErrors()` on every file when `sourcePrefixes` is empty, or only files
whose names start with a supplied prefix while the phased rollout is in
progress. Retain all existing Build/Done-when, title, edge, card, and size checks
for every file regardless of this filter.

- [ ] **Step 4: Enumerate every source-plan URL**

Extend `allUrls()` to walk every required option and optional source. Continue enumerating problem-card URLs; stop scraping URLs from descriptions once all legacy `Resources:` prose is removed:

```js
const plan = t.sourcePlan;
if (plan?.policy === 'required') {
  for (const requirement of plan.requirements)
    for (const option of requirement.options)
      out.push({ file, where: `topic "${t.title}" source "${option.id}"`, url: option.url });
  for (const option of plan.optional ?? [])
    out.push({ file, where: `topic "${t.title}" optional source "${option.id}"`, url: option.url });
}
```

- [ ] **Step 5: Add the phase-scoped CLI option and exact scripts**

Parse repeatable `--source-prefix NN` arguments in
`validate-web3-content.mjs`, pass them to `structuralErrors`, and document the
flag in the file header. `--check-urls NN` continues to limit live checks.

Add to root `package.json`:

```json
"web3:content:test": "node --test scripts/lib/web3-content.test.mjs",
"web3:content:validate": "node scripts/validate-web3-content.mjs --check-coverage"
```

- [ ] **Step 6: Run the focused test**

Run: `yarn web3:content:test`

Expected: PASS. Do not run full structural validation yet; existing content is expected to fail until Tasks 2–7 finish.

- [ ] **Step 7: Commit checkpoint (only with explicit approval)**

```bash
git add scripts/lib/web3-content.mjs scripts/lib/web3-content.test.mjs scripts/validate-web3-content.mjs package.json
git commit -m "test: enforce Web3 source plans"
```

---

### Task 1A: Partition oversized/research-heavy files and lock manifest parity

**Files:**
- Modify: `content/web3/01-fundamentals.json`
- Modify: `content/web3/03-tooling.json`
- Modify: `content/web3/05-gas.json`
- Modify: `content/web3/06c-attacks.json`
- Modify: `content/web3/06d-wargames.json`
- Modify: `content/web3/08-evm-internals.json`
- Modify: `content/web3/09-frontier.json`
- Create: ordered split files described below
- Modify: `apps/api/src/courses/course-manifest.ts`
- Create: `apps/api/src/courses/course-manifest.spec.ts`

**Interfaces:**
- Produces file-sized, independently researchable ownership units before parallel curation.
- Guarantees the Courses UI manifest exactly matches the loader's ordered Web3 files.

- [ ] **Step 1: Add a manifest-parity characterization test**

In `course-manifest.spec.ts`, read `content/web3`, select the same `NN[a-z]?-*.json` names as `loadContentFiles()`, prefix them with `web3/`, and assert exact ordered equality with the `web3` manifest entry. Run it once on the current tree to prove the characterization is green.

- [ ] **Step 2: Split at existing coherent chapter boundaries**

Create these ownership units, preserving topic order and moving every prompt with its target topic:

- `01a-core-ethereum` (15 leaves), `01b-consensus-scaling-aa` (15);
- `03a-foundry-core-testing` (11), `03b-foundry-ops-config` (10), `03c-hardhat` (8);
- `05a-storage-calldata-control-flow` (19), `05b-types-assembly-architecture` (14);
- retain `06a` and `06b`; split current `06c` into `06c-external-crypto-mev` (14) and `06d-proxy-dos-business` (12); rename current wargames file to `06e-wargames` (15);
- `08a-opcodes-yul-huff` (14), `08b-dispatch-storage-proxies-verification` (15); place `Huff jump tables & when Huff pays off` in `08b` so its selector prerequisite is earlier while `Metamorphic contracts` can still depend on `CREATE & CREATE2 opcodes` from `08a`;
- `09a-mev-intents-hooks` (13), `09b-restaking-rwa-zk-l2` (15).

Keep existing `02a`, `02b`, `04a`, `04b`, `07a`, `07b`, and `10-fullstack` as their own ownership units. Do not rewrite topic prose or source URLs in this mechanical task.

- [ ] **Step 3: Confirm manifest test RED, then reconcile once**

Run the manifest test after the filesystem split but before editing `COURSE_MANIFEST`; it must fail with the old filenames. Update the Web3 manifest once to the exact sorted dependency order, then rerun it green. Parallel curation agents do not edit the manifest.

- [ ] **Step 4: Validate the partition**

```bash
yarn workspace @terrain/api test --runInBand src/courses/course-manifest.spec.ts
node scripts/validate-web3-content.mjs --source-prefix 99 --check-coverage
```

Expected: manifest parity passes; all 457 topics/514 cards remain present; prompt targeting and earlier-file parent/prerequisite resolution remain valid; every file stays under 40 topics and 90KB. The deliberately unmatched prefix `99` suppresses only the new source-migration rules during this pre-curation partition; all older structural rules still run across the whole corpus. Full validation without a prefix remains the mandatory final gate.

- [ ] **Step 5: Per-task review**

Review exact topic/card conservation, same-file prompt targeting, cross-file dependency order, filenames, and manifest parity. No curation judgments belong in this task.

---

### Task 2: Curate Phase 1 fundamentals

**Files:**
- Modify: `content/web3/00-root.json` (remove the ten untracked phase-level `Resources:` fragments; no source plans on structural concepts)
- Modify: `content/web3/01a-core-ethereum.json`
- Modify: `content/web3/01b-consensus-scaling-aa.json`

**Interfaces:**
- Produces complete source plans for Phase 1 pattern topics.
- Establishes the content style used by later phases.

- [ ] **Step 1: Inventory Phase 1 leaves**

Run a Node one-liner over both `01*.json` ownership units.

Expected: one title per reviewable Phase 1 leaf.

- [ ] **Step 2: Curate every listed leaf using the global rubric**

For fundamentals, normally require:

- one pedagogical explanation for a first mental model;
- one canonical Ethereum/protocol reference when exact semantics matter;
- a worked source only when the Build cannot be completed from the first two.

Use official Ethereum documentation, current protocol specifications/EIPs,
current tool documentation, and the already-approved course/book spine. Verify
all current-state claims as of the execution date. Add source plans and remove
`Resources:` from descriptions.

- [ ] **Step 3: Check file size and split without changing import order**

Run the validator and confirm both ownership units remain below 90,000 fenced bytes. If research still makes one too large, report the needed coherent split to the controller; do not edit the shared manifest from a parallel curation task.

- [ ] **Step 4: Validate Phase 1 structure and URLs**

```bash
yarn web3:content:test
node scripts/validate-web3-content.mjs --source-prefix 00 --source-prefix 01 --check-urls 01
```

Expected: zero structural errors and zero URL failures for the root/Phase 1. Missing
source plans in later phases are intentionally not enforced by this scoped run;
all their pre-existing structural rules still run.

- [ ] **Step 5: Review every Phase 1 plan manually**

For each leaf, confirm options in one requirement are interchangeable, separate requirements add distinct value, scopes are bounded, total minimum time is plausible, and `why` is specific. Fix every failure before continuing.

- [ ] **Step 6: Commit checkpoint (only with explicit approval)**

```bash
git add content/web3/00-root.json content/web3/01*
git commit -m "content: ground Web3 fundamentals in curated sources"
```

---

### Task 3: Curate Phase 2 Solidity language

**Files:**
- Modify: `content/web3/02a-solidity.json`
- Modify: `content/web3/02b-solidity.json`
- Create if needed: additional ordered `content/web3/02[c-z]-*.json`

**Interfaces:**
- Produces source plans for every Solidity language leaf.

- [ ] **Step 1: Inventory all Phase 2 leaves**

Run a Node one-liner over both `02*.json` files and save the terminal output in the implementation notes. Confirm each title appears exactly once.

- [ ] **Step 2: Curate with Solidity-specific roles**

For each leaf, compare the current Solidity documentation, Solidity-by-Example,
the approved Updraft lesson, and a worked implementation source where useful.
Use the Solidity docs as the canonical requirement for language semantics;
alternatives may replace a teaching source but not canonical semantics. For
storage, calls, ABI, signatures, assembly, and transient storage, add a distinct
mechanism/reference requirement when the introductory source omits edge cases.

- [ ] **Step 3: Remove prose URLs and preserve Build/Done-when**

Every edited leaf description becomes concept-only. Do not change `aiContext`
except to fix a source-dependent factual error discovered during curation.

- [ ] **Step 4: Split oversized payloads**

Run the validator. If an ownership unit still exceeds 90KB, report a coherent
subchapter split to the controller. Keep each prompt in the same file as its
target topic; the controller updates the shared manifest once.

- [ ] **Step 5: Validate Phase 2**

```bash
yarn web3:content:test
node scripts/validate-web3-content.mjs --source-prefix 02 --check-urls 02
```

Expected: all Phase 2 structural and URL checks pass.

- [ ] **Step 6: Commit checkpoint (only with explicit approval)**

```bash
git add content/web3/02*
git commit -m "content: add source plans for Solidity language"
```

---

### Task 4: Curate Phase 3 tooling

**Files:**
- Modify: `content/web3/03a-foundry-core-testing.json`
- Modify: `content/web3/03b-foundry-ops-config.json`
- Modify: `content/web3/03c-hardhat.json`

**Interfaces:**
- Produces current Foundry/Hardhat source plans with freshness metadata.

- [ ] **Step 1: Inventory Phase 3 leaves**

List every `pattern` topic and identify whether it belongs to Foundry, Hardhat,
interop, or supporting analysis tooling.

- [ ] **Step 2: Curate current official tooling sources**

Use official Foundry Book, Hardhat 3 documentation, and official tool docs as
canonical/current requirements. Use course material only as a pedagogical or
worked alternative. Because commands and configuration change, set
`verifiedAt` to the execution date and choose a 180-day `recheckAfterDays` for
tooling docs unless a shorter interval is justified.

- [ ] **Step 3: Split if required and validate**

```bash
yarn web3:content:test
node scripts/validate-web3-content.mjs --source-prefix 03 --check-urls 03
```

Expected: size/topic limits and all URLs pass.

- [ ] **Step 4: Commit checkpoint (only with explicit approval)**

```bash
git add content/web3/03*
git commit -m "content: ground Web3 tooling in current docs"
```

---

### Task 5: Curate Phases 4–5 standards, patterns, and gas

**Files:**
- Modify: `content/web3/04a-standards.json`
- Modify: `content/web3/04b-standards.json`
- Modify: `content/web3/05a-storage-calldata-control-flow.json`
- Modify: `content/web3/05b-types-assembly-architecture.json`

**Interfaces:**
- Produces source plans for standards, patterns, upgradeability, and gas.

- [ ] **Step 1: Curate standards with specification plus implementation roles**

For each ERC/EIP, use the final/current specification as canonical and a current
OpenZeppelin or equivalent implementation reference as a separate worked/threat
model role when code is involved. Do not treat an implementation guide as a
replacement for the specification.

- [ ] **Step 2: Curate patterns and upgradeability**

Compare official OpenZeppelin docs/contracts, relevant EIPs, and the approved
worked courses. Require an adversarial/security source where misuse is the main
risk. Mark changing library documentation for periodic recheck.

- [ ] **Step 3: Curate gas topics**

Use current Solidity/EVM semantics as canonical and the approved RareSkills/
gas-puzzle material as worked practice. Reject folklore-only optimization lists;
every recommendation must have a current mechanism or measurable exercise.

- [ ] **Step 4: Split and validate**

```bash
yarn web3:content:test
node scripts/validate-web3-content.mjs --source-prefix 04 --check-urls 04
node scripts/validate-web3-content.mjs --source-prefix 05 --check-urls 05
```

Expected: zero structural/URL failures for both phases.

- [ ] **Step 5: Commit checkpoint (only with explicit approval)**

```bash
git add content/web3/04* content/web3/05*
git commit -m "content: curate standards patterns and gas sources"
```

---

### Task 6: Curate Phase 6 security and auditing

**Files:**
- Modify: `content/web3/06a-security-methodology.json`
- Modify: `content/web3/06b-attacks.json`
- Modify: `content/web3/06c-external-crypto-mev.json`
- Modify: `content/web3/06d-proxy-dos-business.json`
- Modify: `content/web3/06e-wargames.json`

**Interfaces:**
- Produces source plans for the highest-stakes curriculum phase.

- [ ] **Step 1: Require complementary security roles**

For attack/mechanism leaves, normally require:

- a canonical/current vulnerability taxonomy or protocol reference;
- a concrete exploit or post-mortem;
- a worked defensive exercise when the Build does not already provide one.

For methodology leaves, use current official tool docs and respected security
engineering handbooks. Do not rely on the deprecated SWC registry as current
authority; historical use must be labeled historical.

- [ ] **Step 2: Verify every mutable security source live**

Check OWASP Smart Contract Top 10, EEA EthTrust, tool docs, wargame versions,
contest platforms, and exploit repositories on the execution date. Record
`verifiedAt` and an appropriate recheck interval. Replace dead/deprecated
resources rather than merely preserving them with a warning.

- [ ] **Step 3: Split and validate**

```bash
yarn web3:content:test
node scripts/validate-web3-content.mjs --source-prefix 06 --check-urls 06
```

Expected: zero structural/URL failures across all Phase 6 files.

- [ ] **Step 4: Perform a full Phase 6 human review**

Review every leaf, not a sample. Confirm the selected sources teach mechanism,
show exploitation, and support mitigation without duplicate roles. Security is
explicitly excluded from sampling-only QA.

- [ ] **Step 5: Commit checkpoint (only with explicit approval)**

```bash
git add content/web3/06*
git commit -m "content: curate smart contract security sources"
```

---

### Task 7: Curate Phases 7–10 DeFi, internals, frontier, and full-stack

**Files:**
- Modify: `content/web3/07a-defi.json`
- Modify: `content/web3/07b-defi.json`
- Modify: `content/web3/08a-opcodes-yul-huff.json`
- Modify: `content/web3/08b-dispatch-storage-proxies-verification.json`
- Modify: `content/web3/09a-mev-intents-hooks.json`
- Modify: `content/web3/09b-restaking-rwa-zk-l2.json`
- Modify: `content/web3/10-fullstack.json`

**Interfaces:**
- Completes source-plan coverage for all remaining Web3 leaves.

- [ ] **Step 1: Curate DeFi mechanics**

Use protocol documentation/whitepapers as canonical, the approved from-scratch
books/courses as worked sources, and incident material where an invariant's
failure is central. Distinguish protocol versions explicitly; never let a V2
tutorial stand in for V3/V4 semantics.

- [ ] **Step 2: Curate EVM internals**

Use the current Yellow Paper/specification family, evm.codes, official Solidity
internals, and bounded implementation exercises. Keep stable theory free of
arbitrary freshness metadata; mark opcode/fork-dependent references current.

- [ ] **Step 3: Curate frontier topics**

Verify every frontier source live. Prefer current project specifications,
research papers, and official architecture docs. Use shorter recheck intervals
for active standards, L2 designs, intents, MEV infrastructure, restaking, and
ZK tooling.

- [ ] **Step 4: Curate full-stack topics**

Use current viem, wagmi, indexing, wallet, and Scaffold-ETH documentation as
canonical/current requirements; add worked sources only when they directly
support the Build. Mark framework docs for periodic recheck.

- [ ] **Step 5: Split and validate every remaining phase**

```bash
yarn web3:content:test
node scripts/validate-web3-content.mjs --source-prefix 07 --check-urls 07
node scripts/validate-web3-content.mjs --source-prefix 08 --check-urls 08
node scripts/validate-web3-content.mjs --source-prefix 09 --check-urls 09
node scripts/validate-web3-content.mjs --source-prefix 10 --check-urls 10
```

Expected: zero structural/URL failures.

- [ ] **Step 6: Commit checkpoint (only with explicit approval)**

```bash
git add content/web3/07* content/web3/08* content/web3/09* content/web3/10*
git commit -m "content: complete Web3 source-plan curation"
```

---

### Task 8: Full curriculum, repository, and local session verification

**Files:**
- Modify only if verification exposes a defect in files already covered by this plan.
- Record evidence in: `.superpowers/sdd/source-grounded/rollout-verification.md`

**Interfaces:**
- Produces a deployable curated course and a complete local proof of the strict source gate.

- [ ] **Step 1: Run complete content validation**

```bash
yarn web3:content:test
yarn web3:content:validate
node scripts/validate-web3-content.mjs --check-urls
```

Expected: 360/360 reviewable leaves have explicit policies; coverage has zero gaps; all IDs, groups, HTTP(S) URLs, scopes, estimates, reasons, freshness pairs, Build/Done-when clauses, prerequisites, prompt targets, topic counts, and payload sizes pass. Investigate every URL failure; do not delete a source merely to make the command green.

- [ ] **Step 2: Audit every phase for learning quality**

Review every leaf against its concept, prerequisites, Build, Done-when, and cards. Confirm each requirement has a distinct role, alternatives are truly interchangeable, security leaves include adversarial material when useful, and no source is stale, duplicated, homepage-only, or broader than its declared scope. Phase reviews from Tasks 2–7 are the primary evidence; this step checks cross-phase consistency and substitutions/rejections.

- [ ] **Step 3: Run focused and repository gates**

```bash
yarn workspace @terrain/types test
yarn workspace @terrain/api test --runInBand src/sources src/import src/sessions src/courses
yarn workspace @terrain/web test
yarn build
yarn test
yarn lint
yarn format:check
yarn workspace @terrain/api exec prisma migrate status
```

Expected: every command exits 0 and Prisma reports the schema up to date.

- [ ] **Step 4: Run the strict local fail/pass/apply/rollback matrix**

Use `Public-key cryptography & wallets` or `Transaction anatomy` and a fresh local test user. Verify all eight scenarios:

1. a first-exposure curated export carries real stored requirement/source IDs;
2. omitting one required reconstruction makes Preview inapplicable;
3. complete curated evidence makes Preview applicable;
4. Apply stores evidence and activates the topic atomically;
5. a rejected import writes neither notes nor application events;
6. a review session does not reopen first-exposure-only sources;
7. an `always` or expired source requires current verification;
8. the model-facing conduct forbids performing the learner's Build task.

Also run a planned legacy topic through export and Preview: export stops, `sourceEvidence` remains empty, and a hand-invented requirement ID is rejected.

- [ ] **Step 5: Review the deploy payload**

Confirm `COURSE_MANIFEST` contains every split file in dependency order and `scripts/import-web3.mjs` validates the final corpus before login. Record exact source counts, substitutions, rejected stale/dead candidates, URL results, test totals, and local smoke evidence in the verification report.

- [ ] **Step 6: Per-task and whole-rollout review**

Review the complete rollout diff for spec compliance, technical/content quality, and cross-file consistency. Fix all Critical/Important findings and re-run the covering gates before deployment.

---

### Task 9: Deployment-ordered production reset and re-import runbook

**Files:**
- Create: `docs/ops/web3-source-plan-production-rollout.md`
- Modify if required: `docs/ops/deploy.md`
- Modify: `scripts/import-web3.mjs`
- Test: `scripts/import-web3.test.mjs`

**Interfaces:**
- Produces exact operator commands for backup, count verification, one-user Web3 deletion, prepared-course re-import, and post-import proof.
- Does not execute production deletion.

- [ ] **Step 1: Write a failing import-verification test**

Extract the smallest pure projection needed to verify imported content and assert that every expected Web3 `pattern` topic has a non-null source plan equal to prepared content. Also pin that verification ignores DSA/other domains and reports missing/extra/duplicate normalized Web3 titles.

- [ ] **Step 2: Run the test and confirm RED**

```bash
node --test scripts/import-web3.test.mjs
```

Expected: FAIL until the verification projection exists.

- [ ] **Step 3: Strengthen `scripts/import-web3.mjs` verification**

Keep the existing ordered preview/apply flow. During its detail sweep, deep-compare every pattern topic's `sourcePlan` with prepared content and fail on null/mismatch. Do not add a backfill or PATCH mode.

- [ ] **Step 4: Write the exact operator runbook**

The runbook must enforce this order:

1. deploy the reviewed code, migration, and curated `content/web3` payload;
2. verify the deployed revision and run a read-only course-content validation;
3. take a timestamped PostgreSQL custom-format backup and prove it can be listed with `pg_restore --list`;
4. resolve exactly one user by exact email and abort unless one row matches;
5. print before counts for that user's Web3 topics, reviews, application events, source evidence, prompts, note summaries, prerequisite edges, session references, and Web3 `CourseImport` markers;
6. open one SQL transaction, lock the target user, recompute/compare expected counts, delete only that user's Web3-dependent rows/topics and Web3 marker in FK-safe order, show preserved DSA/other-domain counts, then leave `COMMIT` as a separate operator action after review (`ROLLBACK` on any mismatch);
7. re-import Web3 through Courses UI (preferred) or the authenticated import script against the deployed API;
8. verify all expected topics/cards/edges and every Web3 pattern topic's non-null, content-equal `sourcePlan`;
9. generate the first production learning export before any session work.

Use actual Prisma table/column names and shell-safe commands. Scope every destructive predicate through the exact target user and `domain = 'Web3'`; never use a title-only delete.

- [ ] **Step 5: Verify the runbook against a disposable local user**

Run the backup/list, before-count, transaction-rollback, re-import, and source-plan verification flow locally against a throwaway user. Prove another user's rows and the same user's DSA rows are unchanged. Do not execute the production transaction.

- [ ] **Step 6: Run tests and review**

```bash
node --test scripts/import-web3.test.mjs
yarn lint
yarn format:check
```

Review the runbook specifically for SQL scoping, FK order, backup restoreability, count guards, and the explicit deploy-before-reset gate.

---

### Task 10: Operator-run production completion gate

**Files:**
- Record results in: `docs/ops/web3-source-plan-production-rollout.md`

**Interfaces:**
- Consumes the deployed reviewed revision and the Task 9 runbook.
- Produces the final production proof; this task requires human production access and confirmation.

- [ ] **Step 1: Deploy before reset**

The operator deploys the reviewed revision using `docs/ops/deploy.md`, records the immutable revision/image, and confirms the live API serves a curated first-exposure `SOURCE PLAN`. If deployment is not confirmed, stop; do not run deletion commands.

- [ ] **Step 2: Human-reviewed backup and counts**

The operator runs the backup and read-only count commands, pastes the outputs into the runbook record, and explicitly confirms the target email and expected Web3 counts.

- [ ] **Step 3: Human-run transaction**

The operator runs the generated SQL through the count/check phase. On any unexpected count, run `ROLLBACK` and investigate. Only the operator enters `COMMIT` after verifying that other users and non-Web3 rows remain unchanged.

- [ ] **Step 4: Re-import and verify production content**

Re-import Web3 through the Courses UI, then run the read-only verifier. Every prepared Web3 pattern topic must exist with non-null content-equal `sourcePlan`; DSA and other domains must retain their pre-reset counts.

- [ ] **Step 5: Complete one production learning session**

Run the first topic through `SELECT → CONSUME → RECONSTRUCT → SYNTHESIZE → CLOSED-SOURCE TEACH-BACK → ELABORATE → learner-authored DO → CONSPECT → RECORD`. Confirm incomplete evidence blocks activation, complete evidence imports, the learner's application event is the only one stored, and a later review does not reopen first-exposure-only sources.

- [ ] **Step 6: Final report**

Record the deployed revision, backup path/check, before/after counts, import totals, production session evidence, commands run, final test totals, all sources reviewed, substitutions made, stale/dead sources rejected, and any remaining limitations. Do not mark the rollout complete until this evidence exists.
