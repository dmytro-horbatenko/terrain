# Web3 Source-Plan Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Curate explicit, bounded, complementary source plans for every reviewable Web3 leaf and safely backfill them onto already-imported topics.

**Architecture:** Prepared content remains the source of truth. The existing Web3 loader validates the shared source-plan schema and adds course-specific structural rules. Content is curated phase-by-phase, then an idempotent API script copies only `sourcePlan` onto matching existing Web3 topics.

**Tech Stack:** JSON learning-os v2 content, Node.js 24 standard library, `@terrain/types` Zod schemas, existing Nest Topics API.

## Global Constraints

- Execute this plan only after `2026-07-10-source-grounded-learning-core.md` passes its repository gate.
- Every `type: 'pattern'` Web3 topic has `sourcePlan.policy = 'required'` or an explicit `policy = 'none'` rationale.
- Curated candidates must be compared; requirement options are alternatives for the same purpose, while separate requirements are complementary.
- Every source uses an exact bounded scope and explains its distinct contribution.
- Prefer primary/canonical technical sources; use pedagogical sources for explanation and worked examples.
- Verify fast-changing Web3 material against current official sources during curation.
- A freshness-sensitive option includes both `verifiedAt` and `recheckAfterDays`; stable sources include neither.
- Remove `Resources:` URLs from leaf descriptions after their plans are authored; keep concept prose in `description` and Build/Done-when in `aiContext`.
- Split files rather than weakening the existing 40-topic/90KB limits.
- Add no dependencies.
- Preserve user edits during backfill: update only `sourcePlan` on `domain = 'Web3'` topics matched by normalized title.
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
      purpose: 'Exact semantics',
      requiredWhen: 'first_exposure',
      options: [{
        id: 'official',
        title: 'Official docs',
        url: 'https://example.com/docs',
        format: 'documentation',
        scope: 'Section 2',
        estimatedMinutes: 10,
        why: 'Canonical behavior',
      }],
    }],
  },
};

test('requires explicit source policy on Web3 leaves', () => {
  assert.deepEqual(sourcePlanErrors(valid, '01.json'), []);
  assert.match(sourcePlanErrors({ ...valid, sourcePlan: undefined }, '01.json')[0], /sourcePlan/);
});
```

Also assert that `policy: none` needs a meaningful rationale through the shared schema and that `allUrls()` returns option and optional-source URLs.

- [ ] **Step 2: Run the Node test and confirm RED**

Run: `node --test scripts/lib/web3-content.test.mjs`

Expected: FAIL because `sourcePlanErrors` is not exported.

- [ ] **Step 3: Replace the old leaf Resources rule**

Remove `URL_RE` and the `description has no Resources: URL` check. Export:

```js
export function sourcePlanErrors(topic, file) {
  if (topic.type !== 'pattern') return [];
  if (!topic.sourcePlan) return [`${file}: leaf "${topic.title}" has no sourcePlan`];
  if (/resources:/i.test(topic.description ?? ''))
    return [`${file}: leaf "${topic.title}" still embeds Resources: in description`];
  return [];
}
```

The shared Zod schema handles plan structure. Extend
`structuralErrors(files, { sourcePrefixes = [] } = {})`: enforce
`sourcePlanErrors()` on every file when `sourcePrefixes` is empty, or only files
whose names start with a supplied prefix while the phased rollout is in
progress. Retain all existing Build/Done-when, title, edge, card, and size checks
for every file regardless of this filter.

- [ ] **Step 4: Enumerate every source-plan URL**

Extend `allUrls()` to walk every required option and optional source:

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

### Task 2: Curate Phase 1 fundamentals

**Files:**
- Modify: `content/web3/01-fundamentals.json`
- Modify if size requires: split into additional `content/web3/01[a-z]-*.json` files
- Modify if split: `apps/api/src/courses/course-manifest.ts`

**Interfaces:**
- Produces complete source plans for Phase 1 pattern topics.
- Establishes the content style used by later phases.

- [ ] **Step 1: Inventory Phase 1 leaves**

Run:

```bash
node -e "const d=require('./content/web3/01-fundamentals.json'); for(const t of d.proposedTopics) if(t.type==='pattern') console.log(t.title)"
```

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

Run:

```bash
node -e "const fs=require('node:fs'); const p='content/web3/01-fundamentals.json'; console.log(fs.statSync(p).size)"
```

Expected: below 90,000 bytes. If it exceeds the limit, split topics and their same-file prompts into ordered `01a-...`, `01b-...` files, keep cross-file prerequisites resolvable from earlier files, and replace the manifest entry with the new ordered filenames.

- [ ] **Step 4: Validate Phase 1 structure and URLs**

```bash
yarn web3:content:test
node scripts/validate-web3-content.mjs --source-prefix 01 --check-urls 01
```

Expected: zero structural errors and zero URL failures for Phase 1. Missing
source plans in later phases are intentionally not enforced by this scoped run;
all their pre-existing structural rules still run.

- [ ] **Step 5: Review every Phase 1 plan manually**

For each leaf, confirm options in one requirement are interchangeable, separate requirements add distinct value, scopes are bounded, total minimum time is plausible, and `why` is specific. Fix every failure before continuing.

- [ ] **Step 6: Commit checkpoint (only with explicit approval)**

```bash
git add content/web3/01* apps/api/src/courses/course-manifest.ts
git commit -m "content: ground Web3 fundamentals in curated sources"
```

---

### Task 3: Curate Phase 2 Solidity language

**Files:**
- Modify: `content/web3/02a-solidity.json`
- Modify: `content/web3/02b-solidity.json`
- Create if needed: additional ordered `content/web3/02[c-z]-*.json`
- Modify if split: `apps/api/src/courses/course-manifest.ts`

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

Run the validator. Split at coherent subchapter boundaries until every fenced
payload is below 90KB and every file has at most 40 topics. Update manifest
ordering and keep each prompt in the same file as its target topic.

- [ ] **Step 5: Validate Phase 2**

```bash
yarn web3:content:test
node scripts/validate-web3-content.mjs --source-prefix 02 --check-urls 02
```

Expected: all Phase 2 structural and URL checks pass.

- [ ] **Step 6: Commit checkpoint (only with explicit approval)**

```bash
git add content/web3/02* apps/api/src/courses/course-manifest.ts
git commit -m "content: add source plans for Solidity language"
```

---

### Task 4: Curate Phase 3 tooling

**Files:**
- Modify: `content/web3/03-tooling.json`
- Create if needed: ordered `content/web3/03[a-z]-*.json`
- Modify if split: `apps/api/src/courses/course-manifest.ts`

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
git add content/web3/03* apps/api/src/courses/course-manifest.ts
git commit -m "content: ground Web3 tooling in current docs"
```

---

### Task 5: Curate Phases 4–5 standards, patterns, and gas

**Files:**
- Modify: `content/web3/04a-standards.json`
- Modify: `content/web3/04b-standards.json`
- Modify: `content/web3/05-gas.json`
- Create if needed: ordered `04[c-z]-*.json` / `05[a-z]-*.json`
- Modify if split: `apps/api/src/courses/course-manifest.ts`

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
git add content/web3/04* content/web3/05* apps/api/src/courses/course-manifest.ts
git commit -m "content: curate standards patterns and gas sources"
```

---

### Task 6: Curate Phase 6 security and auditing

**Files:**
- Modify: `content/web3/06a-security-methodology.json`
- Modify: `content/web3/06b-attacks.json`
- Modify: `content/web3/06c-attacks.json`
- Modify: `content/web3/06d-wargames.json`
- Create if needed: ordered `06[e-z]-*.json`
- Modify if split: `apps/api/src/courses/course-manifest.ts`

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
git add content/web3/06* apps/api/src/courses/course-manifest.ts
git commit -m "content: curate smart contract security sources"
```

---

### Task 7: Curate Phases 7–10 DeFi, internals, frontier, and full-stack

**Files:**
- Modify: `content/web3/07a-defi.json`
- Modify: `content/web3/07b-defi.json`
- Modify: `content/web3/08-evm-internals.json`
- Modify: `content/web3/09-frontier.json`
- Modify: `content/web3/10-fullstack.json`
- Create if needed: ordered split files for the same numeric phase
- Modify if split: `apps/api/src/courses/course-manifest.ts`

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
git add content/web3/07* content/web3/08* content/web3/09* content/web3/10* apps/api/src/courses/course-manifest.ts
git commit -m "content: complete Web3 source-plan curation"
```

---

### Task 8: Idempotent existing-topic backfill

**Files:**
- Create: `scripts/backfill-web3-source-plans.mjs`
- Modify: `scripts/lib/web3-content.mjs`
- Create: `scripts/backfill-web3-source-plans.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: all curated content files and authenticated Topics API.
- Produces: dry-run/apply/verify modes that update only `sourcePlan`.

- [ ] **Step 1: Extract and test a pure backfill plan**

Export:

```js
export function buildSourcePlanBackfill(contentTopics, apiTopics) {
  const byTitle = new Map(apiTopics.filter((topic) => topic.domain === 'Web3')
    .map((topic) => [norm(topic.title), topic]));
  return contentTopics
    .filter((topic) => topic.type === 'pattern')
    .map((topic) => ({
      topicId: byTitle.get(norm(topic.title))?.id ?? null,
      title: topic.title,
      sourcePlan: topic.sourcePlan,
    }));
}
```

Test exact-title normalization, missing API topics, non-Web3 exclusion, and
that returned patches contain no field except id/title/sourcePlan.

- [ ] **Step 2: Run the Node test and confirm RED**

Run: `node --test scripts/backfill-web3-source-plans.test.mjs`

Expected: FAIL because the script/helper does not exist.

- [ ] **Step 3: Implement authenticated dry-run/apply/verify**

Reuse the login and cookie pattern from `scripts/import-web3.mjs`. CLI behavior:

```text
node scripts/backfill-web3-source-plans.mjs --dry-run
node scripts/backfill-web3-source-plans.mjs --apply
node scripts/backfill-web3-source-plans.mjs --verify
```

Rules:

- load and structurally validate all content first;
- GET `/topics`, reject duplicate normalized Web3 titles;
- report missing/extra titles and stop before writes;
- `--dry-run` print one planned PATCH per leaf;
- `--apply` PATCH `/topics/:id` with exactly `{ sourcePlan }`;
- `--verify` GET every leaf detail and deep-compare its plan to content;
- apply twice successfully with the second run reporting zero differences.

- [ ] **Step 4: Add scripts**

```json
"web3:sources:backfill": "node scripts/backfill-web3-source-plans.mjs --apply",
"web3:sources:verify": "node scripts/backfill-web3-source-plans.mjs --verify"
```

- [ ] **Step 5: Run unit test and dry-run**

```bash
node --test scripts/backfill-web3-source-plans.test.mjs
node scripts/backfill-web3-source-plans.mjs --dry-run
```

Expected: test passes; dry-run reports exactly one patch per existing Web3 pattern topic and performs no writes.

- [ ] **Step 6: Apply twice and verify**

With the local API/database running and credentials set:

```bash
node scripts/backfill-web3-source-plans.mjs --apply
node scripts/backfill-web3-source-plans.mjs --apply
node scripts/backfill-web3-source-plans.mjs --verify
```

Expected: first run updates plans; second run changes zero topics; verify reports no mismatches. Inspect one non-source user edit before and after to confirm it is unchanged.

- [ ] **Step 7: Commit checkpoint (only with explicit approval)**

```bash
git add scripts/backfill-web3-source-plans.mjs scripts/backfill-web3-source-plans.test.mjs scripts/lib/web3-content.mjs package.json
git commit -m "feat: backfill Web3 source plans safely"
```

---

### Task 9: Full curriculum and session verification

**Files:**
- Modify only if verification exposes defects in files already covered by this plan.

**Interfaces:**
- Produces a fully curated, validated, and usable Web3 learning path.

- [ ] **Step 1: Run complete content validation**

```bash
yarn web3:content:test
yarn web3:content:validate
node scripts/validate-web3-content.mjs --check-urls
```

Expected: all content parses, coverage has zero gaps, every leaf has an explicit source policy, and every unique URL responds successfully.

- [ ] **Step 2: Run repository gates**

```bash
yarn build
yarn test
yarn lint
yarn format:check
```

Expected: all exit 0.

- [ ] **Step 3: Sample every phase for quality**

Select at least three leaves per phase: one theory-heavy, one implementation,
and one edge/security-heavy topic where available. Confirm requirement roles,
alternatives, scopes, estimates, reasons, and freshness metadata manually.
Phase 6 remains fully reviewed from Task 6 rather than sampled.

- [ ] **Step 4: Run the original wallet topic end-to-end**

Generate the first-exposure session for `Public-key cryptography & wallets`.
Confirm it selects the curated sources before teaching, pauses for intake,
requires separate reconstruction and cross-source synthesis, refuses to perform
the README task, and blocks import when either source evidence entry is missing.
Complete the learner-authored task, import, and confirm topic activation plus
stored evidence.

- [ ] **Step 5: Run a review-mode regression**

Generate a later session for an active topic with no `always` requirements.
Confirm it starts retrieval without forcing the original sources. Repeat with
an expired or `always` source and confirm verification is required.

- [ ] **Step 6: Commit checkpoint (only with explicit approval)**

```bash
git status --short
git add content/web3 scripts apps/api/src/courses/course-manifest.ts docs/superpowers/plans/2026-07-10-web3-source-plan-rollout.md
git commit -m "feat: roll out source-grounded Web3 curriculum"
```

Expected: only files belonging to this rollout are staged; unrelated user changes remain unstaged.
