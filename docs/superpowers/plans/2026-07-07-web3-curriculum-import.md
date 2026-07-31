# Web3 / Solidity / DeFi Curriculum Content Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The per-phase authoring tasks (Tasks 3–13) are independent and subagent-friendly — dispatch one fresh authoring agent per phase file, each gated by the validator.

**Goal:** Author the ~305–365-topic Web3/Solidity/DeFi learning graph as a set of `content/web3/*.json` v2 learning-os files (root + 10 phases, split into ~16 import-ordered files, ~700–900 SR cards), scaffold a hybrid Foundry+Hardhat practice monorepo the topics point into, and land the graph in the user's real account via a preview-gated import script against `/sessions/import`.

**Architecture:** Content lives in `content/web3/` (import-ordered `NN[-x]-slug.json`, one or more per phase). A shared lib (`scripts/lib/web3-content.mjs`) loads + structurally validates the files; `scripts/validate-web3-content.mjs` is its CLI plus a URL live-check and a coverage-checklist check against `content/web3/coverage.json`; `scripts/import-web3.mjs` logs in, mints a SessionExport per file, previews, gates, applies, and verifies. The practice repo is a **separate git repo** scaffolded once (structure + configs + README index only; the learner writes solution code). No Terrain API, schema, web, or seed changes.

**Tech Stack:** Node 24 `.mjs` scripts (repo root, `import.meta.dirname`), `@terrain/types` (`learningOsV2Schema`) via the root `node_modules` workspace symlink, plain `fetch`. Practice repo: Foundry (forge/cast/anvil) + Hardhat 3 (TS, reads `foundry.toml`).

**Spec:** `docs/superpowers/specs/2026-07-07-web3-solidity-defi-curriculum-design.md`
**Precedent to mirror:** the DSA import (`content/dsa/*.json`, `scripts/lib/dsa-content.mjs`, `scripts/validate-dsa-content.mjs`, `scripts/import-dsa.mjs`, plan `docs/superpowers/plans/2026-07-02-dsa-curriculum-import.md`). Read those before starting — this plan reuses their shape and the same import endpoints.

## Global Constraints

- **NO git commits** in the Terrain repo. Repo policy: work stays uncommitted unless the user explicitly asks. Every "commit" habit from the executing skill is replaced by "leave in working tree". (The separate practice repo DOES get committed — it's its own repo, Task 14.)
- `yarn build` must have been run at least once (the validator imports `@terrain/types` from `dist/`). If `node_modules/@terrain/types/dist/index.js` is missing, run `yarn workspace @terrain/types build`.
- API runs on `http://localhost:3000`, **no `/api` prefix** (the web proxy strips it; scripts talk to :3000 directly).
- Rate limit: global 100 req/min throttle — any script loop over endpoints paces at **650 ms** between calls.
- Contract caps (enforced by `learningOsV2Schema`, `packages/types/src/index.ts:9-86`): ≤200 `proposedTopics` and ≤500 `proposedPrompts` per file; `description` ≤2000 chars; `aiContext` ≤2000 chars; `promptText`/`answerHint` ≤2000 chars; `estimatedMinutes` int 1–240; `title` ≤300. `proposedTopicSchema` and `proposedPromptV2Schema` are `.strict()` — **no extra keys**.
- **File-size rule:** keep each content file to **≤40 topics** AND a fenced-payload **≤90 KB** (the validator enforces both). Phases over that are split into numbered sub-files (`06a-…`, `06b-…`); files import in filename-sort order regardless of phase.
- **TopicType reuse:** every topic uses `type: "concept"` (path/phase/sub-chapter nodes) or `type: "pattern"` (leaf, the reviewable SR unit). Both rows already exist from the seed — **no seed change**. Do not invent new type strings.
- `domain: "Web3"` on **every** topic (keeps the graph filterable and separate from DSA).
- **Titles are identity:** every `title`, `parentTitle`, `prerequisiteTitles[]`, and `topicTitle` string must be **globally unique** across all web3 files and copied **verbatim** (resolution is trim+lowercase, but don't rely on it). A parent/prereq may reference a title defined in the **same or an earlier-sorting file** only.

### The five-part content model → field mapping (every leaf topic follows this)

The spec's content model does not fit one 2000-char field, so it splits across the two text fields the schema already gives each topic, plus the cards:

- **`description`** (≤2000) = **CONCEPT + RESOURCES.** 2–4 sentences defining the idea and why it bites, then a `Resources:` line with 1–3 specific anchors (▶ video / 📖 read / 🔗 ref) as real URLs — never a bare "watch Updraft".
- **`aiContext`** (≤2000) = **BUILD + DONE-WHEN.** `Build:` the hands-on task naming the exact practice-repo path it writes into (e.g. `contracts/phase02/Delegatecall.sol` + a Foundry test). `Done when:` explicit exit criteria (tests pass / gas under target / exploit reproduced then reverts / invariant holds). Pure-theory topics may use a non-code Build ("write an explainer").
- **`proposedPrompts[]`** = **PROMPTS.** Card kinds (`promptKind`):
  - `concept` (**≥1 required on every `pattern` leaf**): retrieval of the durable idea. `promptText` a question, `answerHint` the cue + one pitfall.
  - `code` (optional): `"Write <X> …"` with a language/tool-appropriate but minimal `answerHint`.
  - `problem` (optional, for security/DeFi exercise topics): links an external wargame/CTF/contest exercise. **`url` required** on this kind; `problemDifficulty` optional (map Ethernaut 0–8 / DVD tiers to easy≤2 / medium 3–5 / hard≥6); `estimatedMinutes` optional. `url`/`problemDifficulty`/`estimatedMinutes` appear **only** on `problem` cards — omit them on `concept`/`code`.

`sessionId` stays `null` in the file — the import script stamps a real export id at import time. Leave `reviews`, `noteSummaries` as `[]`; omit `applicationEvents`, `studiedTopics`, `nextSession` entirely.

### File shape (every `content/web3/NN[-x]-slug.json`)

```json
{
  "version": 2,
  "sessionId": null,
  "reviews": [],
  "proposedTopics": [
    { "title": "...", "type": "concept|pattern", "domain": "Web3",
      "description": "CONCEPT … Resources: …", "aiContext": "Build: … Done when: …",
      "prerequisiteTitles": [], "parentTitle": "..." }
  ],
  "proposedPrompts": [
    { "topicTitle": "...", "promptText": "...", "answerHint": "...", "promptKind": "concept" }
  ],
  "noteSummaries": []
}
```

### Validation loop (every authoring task, Tasks 3–13)

After writing/editing a file, both must exit 0 before the task is done:

```bash
node scripts/validate-web3-content.mjs               # structural, all files so far
node scripts/validate-web3-content.mjs --check-urls NN   # live URL HEAD check, this file only
```

After the LAST authoring task, also run `node scripts/validate-web3-content.mjs --check-coverage` (Task 13) — 0 gaps.

---

### Task 1: Shared content lib + validator CLI

**Files:**
- Create: `scripts/lib/web3-content.mjs`
- Create: `scripts/validate-web3-content.mjs`

**Interfaces:**
- Produces: `loadContentFiles(dir) -> Promise<Array<{ file, doc }>>` (throws on JSON/schema error), `structuralErrors(files) -> string[]`, `norm(s)`, `CONTENT_DIR` — from `scripts/lib/web3-content.mjs`; all consumed by Task 15's import script and the validator CLI. CLI exit 0 = valid.

- [ ] **Step 1: Write `scripts/lib/web3-content.mjs`**

```js
// Shared loader + structural checks for content/web3/*.json (learning-os v2).
// Used by validate-web3-content.mjs (CLI) and import-web3.mjs (pre-flight).
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { learningOsV2Schema } from '@terrain/types';

export const CONTENT_DIR = path.resolve(import.meta.dirname, '../../content/web3');
export const norm = (s) => s.trim().toLowerCase();
const URL_RE = /https?:\/\/[^\s)]+/;

export async function loadContentFiles(dir = CONTENT_DIR) {
  // NN-slug.json or NN[a-z]-slug.json (e.g. 06a-...); sorted = import order.
  const names = (await readdir(dir)).filter((n) => /^\d\d[a-z]?-.*\.json$/.test(n)).sort();
  if (names.length === 0) throw new Error(`no NN-*.json content files in ${dir}`);
  const files = [];
  for (const name of names) {
    const raw = await readFile(path.join(dir, name), 'utf8');
    let json;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      throw new Error(`${name}: invalid JSON — ${e.message}`);
    }
    const parsed = learningOsV2Schema.safeParse(json);
    if (!parsed.success) throw new Error(`${name}: schema — ${parsed.error.message}`);
    files.push({ file: name, doc: parsed.data });
  }
  return files;
}

// Structural rules beyond the Zod schema. Returns human-readable errors.
export function structuralErrors(files) {
  const errors = [];
  const seenTitles = new Map(); // norm(title) -> file
  for (const { file, doc } of files) {
    const local = new Map(doc.proposedTopics.map((t) => [norm(t.title), t]));
    if (doc.proposedTopics.length > 40)
      errors.push(`${file}: ${doc.proposedTopics.length} topics — over the 40/file split rule`);
    for (const t of doc.proposedTopics) {
      if (t.domain !== 'Web3') errors.push(`${file}: "${t.title}" domain "${t.domain}" (must be Web3)`);
      if (t.type !== 'concept' && t.type !== 'pattern')
        errors.push(`${file}: "${t.title}" type "${t.type}" (must be concept|pattern)`);
      if (seenTitles.has(norm(t.title)))
        errors.push(`${file}: duplicate topic "${t.title}" (also in ${seenTitles.get(norm(t.title))})`);
      const resolvable = (ref) => seenTitles.has(norm(ref)) || local.has(norm(ref));
      if (t.parentTitle && !resolvable(t.parentTitle))
        errors.push(`${file}: "${t.title}" parent "${t.parentTitle}" not in this or an earlier file`);
      for (const pre of t.prerequisiteTitles)
        if (!resolvable(pre)) errors.push(`${file}: "${t.title}" prereq "${pre}" not in this or an earlier file`);
      if (t.type === 'pattern') {
        // Leaf content-model checks: description carries a resource URL; aiContext carries Build + Done-when.
        if (!URL_RE.test(t.description ?? ''))
          errors.push(`${file}: leaf "${t.title}" description has no Resources: URL`);
        const ai = t.aiContext ?? '';
        if (!/build:/i.test(ai) || !/done when:/i.test(ai))
          errors.push(`${file}: leaf "${t.title}" aiContext missing "Build:" or "Done when:"`);
      }
    }
    for (const p of doc.proposedPrompts) {
      const target = local.get(norm(p.topicTitle));
      if (!target)
        errors.push(`${file}: prompt targets "${p.topicTitle}" — not a topic in the SAME file`);
      else if (target.type !== 'pattern')
        errors.push(`${file}: prompt targets non-pattern topic "${p.topicTitle}"`);
      if (p.promptKind === 'problem') {
        if (!p.url) errors.push(`${file}: problem card on "${p.topicTitle}" missing url`);
      } else if (p.url || p.problemDifficulty || p.estimatedMinutes) {
        errors.push(`${file}: ${p.promptKind} card on "${p.topicTitle}" carries problem-only fields`);
      }
    }
    for (const t of doc.proposedTopics) {
      if (t.type !== 'pattern') continue;
      if (!doc.proposedPrompts.some((p) => norm(p.topicTitle) === norm(t.title) && p.promptKind === 'concept'))
        errors.push(`${file}: leaf "${t.title}" has no concept card`);
    }
    const fenced = '```learning-os\n' + JSON.stringify(doc) + '\n```';
    if (Buffer.byteLength(fenced) > 90_000)
      errors.push(`${file}: fenced payload ${Buffer.byteLength(fenced)} bytes — over the 90KB margin (split the file)`);
    for (const t of doc.proposedTopics) seenTitles.set(norm(t.title), file);
  }
  return errors;
}

// All external URLs referenced anywhere (descriptions + problem-card urls).
export function allUrls(files) {
  const out = [];
  for (const { file, doc } of files) {
    for (const t of doc.proposedTopics)
      for (const m of (t.description ?? '').matchAll(/https?:\/\/[^\s)]+/g))
        out.push({ file, where: `topic "${t.title}"`, url: m[0].replace(/[.,;]+$/, '') });
    for (const p of doc.proposedPrompts)
      if (p.url) out.push({ file, where: `card on "${p.topicTitle}"`, url: p.url });
  }
  return out;
}
```

- [ ] **Step 2: Write `scripts/validate-web3-content.mjs`**

```js
// CLI: structural validation of content/web3 (always) + optional live URL check
// + optional coverage-checklist check.
//   node scripts/validate-web3-content.mjs [--dir <path>] [--check-urls [NN]] [--check-coverage]
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadContentFiles, structuralErrors, allUrls, norm, CONTENT_DIR } from './lib/web3-content.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1]?.startsWith('--') || args[i + 1] === undefined ? true : args[i + 1];
};
const dir = typeof flag('--dir') === 'string' ? flag('--dir') : CONTENT_DIR;
const checkUrls = flag('--check-urls'); // true | 'NN' | undefined
const checkCoverage = flag('--check-coverage') !== undefined;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const files = await loadContentFiles(dir).catch((e) => {
  console.error(`LOAD FAIL: ${e.message}`);
  process.exit(1);
});
const errors = structuralErrors(files);
for (const e of errors) console.error(`STRUCTURAL: ${e}`);
console.log(
  `${files.length} files, ${files.reduce((n, f) => n + f.doc.proposedTopics.length, 0)} topics, ` +
    `${files.reduce((n, f) => n + f.doc.proposedPrompts.length, 0)} cards — ${errors.length} structural errors`,
);
if (errors.length > 0) process.exit(1);

if (checkUrls !== undefined) {
  const scope = typeof checkUrls === 'string' ? allUrls(files).filter((u) => u.file.startsWith(checkUrls)) : allUrls(files);
  const seen = new Set();
  let bad = 0;
  for (const u of scope) {
    if (seen.has(u.url)) continue;
    seen.add(u.url);
    try {
      let res = await fetch(u.url, { method: 'HEAD', redirect: 'follow' });
      if (res.status === 405 || res.status === 403) res = await fetch(u.url, { method: 'GET', redirect: 'follow' });
      if (res.status >= 400) {
        console.error(`URL ${res.status}: ${u.url} [${u.file} ${u.where}]`);
        bad++;
      }
    } catch (e) {
      console.error(`URL ERR: ${u.url} — ${e.message} [${u.file} ${u.where}]`);
      bad++;
    }
    await sleep(300);
  }
  console.log(`${seen.size} unique urls checked, ${bad} failures`);
  if (bad > 0) process.exit(1);
}

if (checkCoverage) {
  const checklist = JSON.parse(await readFile(path.join(dir, 'coverage.json'), 'utf8'));
  const haystack = files
    .flatMap((f) => [
      ...f.doc.proposedTopics.map((t) => `${t.title}\n${t.description ?? ''}\n${t.aiContext ?? ''}`),
      ...f.doc.proposedPrompts.map((p) => `${p.promptText}\n${p.answerHint ?? ''}\n${p.url ?? ''}`),
    ])
    .join('\n')
    .toLowerCase();
  let gaps = 0;
  for (const [group, items] of Object.entries(checklist)) {
    for (const item of items) {
      // each item is { needle } — a substring that must appear somewhere in the corpus
      if (!haystack.includes(item.toLowerCase())) {
        console.error(`COVERAGE GAP [${group}]: "${item}" not found in any topic/card`);
        gaps++;
      }
    }
  }
  console.log(`coverage: ${gaps} gaps`);
  if (gaps > 0) process.exit(1);
}
```

- [ ] **Step 3: Verify against fixtures (no content exists yet)**

```bash
mkdir -p "$SCRATCH/web3-fixtures" && cd /path/to/consistency
cat > "$SCRATCH/web3-fixtures/01-good.json" << 'EOF'
{ "version": 2, "sessionId": null, "reviews": [],
  "proposedTopics": [
    { "title": "Web3 / Solidity / DeFi", "type": "concept", "domain": "Web3", "description": "root", "prerequisiteTitles": [], "parentTitle": null },
    { "title": "Reentrancy — single-function", "type": "pattern", "domain": "Web3",
      "description": "A callee re-enters before state settles. Resources: https://ethernaut.openzeppelin.com/",
      "aiContext": "Build: write a vulnerable vault + Attacker.sol in security/. Done when: exploit drains it then reverts after the fix.",
      "prerequisiteTitles": [], "parentTitle": "Web3 / Solidity / DeFi" } ],
  "proposedPrompts": [
    { "topicTitle": "Reentrancy — single-function", "promptText": "When does single-function reentrancy bite?", "answerHint": "external call before state update; guard + CEI", "promptKind": "concept" } ],
  "noteSummaries": [] }
EOF
cat > "$SCRATCH/web3-fixtures/02-bad.json" << 'EOF'
{ "version": 2, "sessionId": null, "reviews": [],
  "proposedTopics": [
    { "title": "Orphan leaf", "type": "pattern", "domain": "DSA", "description": "no url here", "aiContext": "nothing", "prerequisiteTitles": ["Nowhere"], "parentTitle": "Missing" } ],
  "proposedPrompts": [
    { "topicTitle": "Elsewhere", "promptText": "x", "promptKind": "problem" } ],
  "noteSummaries": [] }
EOF
node scripts/validate-web3-content.mjs --dir "$SCRATCH/web3-fixtures"
```

(`$SCRATCH` = the session scratchpad dir.) Expected: exit 1 with STRUCTURAL errors for `02-bad.json` — wrong domain (DSA), leaf with no Resources URL, aiContext missing Build/Done-when, unresolvable parent "Missing" and prereq "Nowhere", prompt targeting "Elsewhere" (not in file), problem card missing url, leaf without a concept card. Delete `02-bad.json`, re-run with `--dir` — expected exit 0: `1 files, 2 topics, 1 cards — 0 structural errors`.

- [ ] **Step 4: Lint/format**

Run: `yarn lint && yarn format:check` — expected clean (run `yarn format` if oxfmt complains). Leave uncommitted.

---

### Task 2: `content/web3/00-root.json` — root + 10 phase-chapter nodes

**Files:**
- Create: `content/web3/00-root.json`

**Interfaces:**
- Produces: the root topic `Web3 / Solidity / DeFi` and the 10 phase concept nodes every later file parents into. No leaves here (so no cards) — concept nodes only.

- [ ] **Step 1: Write the file** (exact content):

```json
{
  "version": 2,
  "sessionId": null,
  "reviews": [],
  "proposedTopics": [
    { "title": "Web3 / Solidity / DeFi", "type": "concept", "domain": "Web3",
      "description": "Root of the Web3 learning path: fundamentals → Solidity → tooling → standards → gas → security → DeFi → EVM internals → frontier → full-stack. Code-first — every leaf has a Build task in the web3-practice repo and a Done-when gate; security threads from Phase 4 and is exhaustive in Phase 6. Study one leaf at a time.",
      "aiContext": "path root, created 2026-07-07. Approach B (phased spiral, woven security). Toolchain: Foundry-primary + Hardhat 3 for TS deploy/full-stack. Extend via living-roadmap prompting.",
      "prerequisiteTitles": [], "parentTitle": null },
    { "title": "Phase 1 — Blockchain & Ethereum Fundamentals", "type": "concept", "domain": "Web3",
      "description": "How Ethereum works: accounts, transactions, gas, the EVM, PoS consensus, L2s/rollups, account abstraction, and the 2025–26 protocol state (Pectra/Fusaka). Mostly theory; entry point. Resources: https://updraft.cyfrin.io/courses/blockchain-basics",
      "prerequisiteTitles": [], "parentTitle": "Web3 / Solidity / DeFi" },
    { "title": "Phase 2 — Solidity Language", "type": "concept", "domain": "Web3",
      "description": "The Solidity language end to end: types, storage, functions, inheritance, events, errors, low-level calls, ABI, signatures, assembly intro. Resources: https://updraft.cyfrin.io/courses/solidity, https://solidity-by-example.org/",
      "prerequisiteTitles": ["Phase 1 — Blockchain & Ethereum Fundamentals"], "parentTitle": "Web3 / Solidity / DeFi" },
    { "title": "Phase 3 — Tooling: Foundry & Hardhat", "type": "concept", "domain": "Web3",
      "description": "Foundry (primary: test/fuzz/invariant/gas/security) and Hardhat 3 (secondary: TS deploy pipelines, full-stack), plus their interop. Resources: https://updraft.cyfrin.io/courses/foundry, https://hardhat.org/docs",
      "prerequisiteTitles": ["Phase 2 — Solidity Language"], "parentTitle": "Web3 / Solidity / DeFi" },
    { "title": "Phase 4 — Core Contract Patterns & Standards", "type": "concept", "domain": "Web3",
      "description": "Token standards (ERC-20/721/1155/4626), proxies/upgradeability, access control, signatures/permit/meta-tx, airdrops, multisig, factories, DAOs — each with its threat model. Resources: https://updraft.cyfrin.io/courses/advanced-foundry",
      "prerequisiteTitles": ["Phase 3 — Tooling: Foundry & Hardhat"], "parentTitle": "Web3 / Solidity / DeFi" },
    { "title": "Phase 5 — Gas Optimization", "type": "concept", "domain": "Web3",
      "description": "Exhaustive gas: storage packing, warm/cold access, calldata, unchecked, bitmaps, custom errors, assembly, architecture. Resources: https://www.rareskills.io/post/gas-optimization-in-solidity, https://github.com/RareSkills/gas-puzzles",
      "prerequisiteTitles": ["Phase 4 — Core Contract Patterns & Standards"], "parentTitle": "Web3 / Solidity / DeFi" },
    { "title": "Phase 6 — Security & Auditing", "type": "concept", "domain": "Web3",
      "description": "The full attack taxonomy + audit methodology, static analysis, fuzzing/invariants, report writing, wargames (Ethernaut, Damn Vulnerable DeFi v4), real-exploit replays, and CodeHawks First Flights. Resources: https://updraft.cyfrin.io/courses/security",
      "prerequisiteTitles": ["Phase 4 — Core Contract Patterns & Standards"], "parentTitle": "Web3 / Solidity / DeFi" },
    { "title": "Phase 7 — DeFi Mechanics & From-Scratch Builds", "type": "concept", "domain": "Web3",
      "description": "Build DeFi from scratch: AMMs, Uniswap V2→V3→V4, lending, stablecoins, oracles, staking/restaking, perps, vaults, flash loans. Resources: https://updraft.cyfrin.io/courses, https://jeiwan.net/",
      "prerequisiteTitles": ["Phase 6 — Security & Auditing"], "parentTitle": "Web3 / Solidity / DeFi" },
    { "title": "Phase 8 — EVM Internals & Advanced Solidity", "type": "concept", "domain": "Web3",
      "description": "Opcodes, Yul/Huff, storage/memory/calldata at the bytecode level, proxies at bytecode level, formal verification. Resources: https://updraft.cyfrin.io/courses/formal-verification, https://www.evm.codes/",
      "prerequisiteTitles": ["Phase 7 — DeFi Mechanics & From-Scratch Builds"], "parentTitle": "Web3 / Solidity / DeFi" },
    { "title": "Phase 9 — Frontier Strands", "type": "concept", "domain": "Web3",
      "description": "MEV, intents/ERC-7683, Uniswap V4 hooks, restaking, RWAs, ZK, L2 internals. Independently orderable after Phase 7. Resources: https://docs.flashbots.net/, https://www.rareskills.io/zk-book",
      "prerequisiteTitles": ["Phase 7 — DeFi Mechanics & From-Scratch Builds"], "parentTitle": "Web3 / Solidity / DeFi" },
    { "title": "Phase 10 — Full-Stack dApp", "type": "concept", "domain": "Web3",
      "description": "viem/wagmi, wallet connection, reading/writing contracts, events/indexing, Scaffold-ETH 2, the Speedrun Ethereum challenge ladder. Resources: https://speedrunethereum.com/, https://scaffoldeth.io/",
      "prerequisiteTitles": ["Phase 7 — DeFi Mechanics & From-Scratch Builds"], "parentTitle": "Web3 / Solidity / DeFi" }
  ],
  "proposedPrompts": [],
  "noteSummaries": []
}
```

- [ ] **Step 2: Validate**

Run: `node scripts/validate-web3-content.mjs`
Expected: exit 0, `1 files, 11 topics, 0 cards — 0 structural errors`. (Concept nodes need no cards; the leaf checks don't apply to them.)

- [ ] **Step 3: Live-check the anchor URLs**

Run: `node scripts/validate-web3-content.mjs --check-urls 00`
Expected: exit 0, 0 failures. If any anchor 404s, replace it with the correct current URL (see the spec's resource table) — do not delete the line.

---

### Task 3: `content/web3/01-fundamentals.json` (EXEMPLAR — sets the quality bar)

**Files:**
- Create: `content/web3/01-fundamentals.json`

This file is the exemplar every later authoring task imitates for JSON structure, the description/aiContext split, resource anchoring, and card phrasing. Phase 1 is ~35 leaves grouped under 7 sub-chapters. **Author all of them**, but the fully-worked topics below define the pattern; the rest follow identically from the Phase-1 topic table.

**Phase 1 sub-chapters** (concept nodes, parent = `Phase 1 — Blockchain & Ethereum Fundamentals`):
Blockchain basics · Accounts, transactions & gas · EVM execution model · Consensus (PoS) · L2s & rollups · Account abstraction · 2025–26 protocol state.

**Phase 1 leaf table** (leaf · parent sub-chapter · primary resource · Build one-liner). Consensus/scaling may use explainers; cryptography, serialization, RPC, hashing, and EVM fundamentals require runnable code plus negative checks:

| Leaf | Sub-chapter | Resource anchor | Build |
|---|---|---|---|
| What a blockchain is | Blockchain basics | Updraft Blockchain Basics §1 | Write a 1-page explainer: blocks, hashes, immutability |
| Public-key cryptography & wallets | Blockchain basics | ethereum.org/developers/docs/accounts | Generate a keypair with `cast wallet new`; explain custody and the derivation overview |
| SEC1 public-key serialization & address derivation | Blockchain basics | SEC 1 §2.3.3 + ethereum.org accounts | Emit compressed/uncompressed keys; hash raw x\|\|y; assert address and wrong-hash pitfalls |
| ECDSA signing, verification & recovery | Blockchain basics | SEC 1 §4.1 + EIP-191 | Sign fixed bytes; verify/recover; assert mutation, domain, low-s, and parity boundaries |
| Mnemonic-to-seed & child-key derivation | Blockchain basics | BIP-39 + BIP-32 | Reproduce official seed and child vectors plus two Ethereum addresses |
| Nodes, clients & JSON-RPC | Blockchain basics | ethereum.org/developers/docs/nodes-and-clients | Query a public RPC with `cast block latest` |
| Raw Ethereum JSON-RPC | Blockchain basics | ethereum.org JSON-RPC | Call Anvil with built-in fetch; validate id/result/error, quantities, timeouts, and block tags |
| EOAs vs contract accounts | Accounts, transactions & gas | ethereum.org/developers/docs/accounts | Diagram both account types + their fields |
| Transaction anatomy | Accounts, transactions & gas | ethereum.org/developers/docs/transactions | Decode a real tx with `cast tx <hash>` |
| RLP & typed transaction serialization | Accounts, transactions & gas | ethereum.org RLP + EIP-1559 | Implement the required RLP subset and type-2 signing/broadcast payload |
| Gas & the fee market (EIP-1559) | Accounts, transactions & gas | ethereum.org/developers/docs/gas | Explain base fee vs priority fee from a real block |
| The EVM as a state machine | EVM execution model | noxx EVM Deep Dives pt.1 | Implement and test a tiny gas-metered interpreter with REVERT rollback |
| Stack / memory / storage / calldata | EVM execution model | evm.codes | Annotate where each data location lives + costs |
| Opcodes & the interpreter loop | EVM execution model | evm.codes | Trace a tiny bytecode snippet on evm.codes |
| Proof-of-Stake basics | Consensus (PoS) | ethereum.org/developers/docs/consensus-mechanisms/pos | Explain validators, attestations, finality |
| The Merge & post-merge issuance | Consensus (PoS) | ethereum.org/roadmap/merge | 1-paragraph before/after issuance |
| Rollups: optimistic vs ZK | L2s & rollups | ethereum.org/developers/docs/scaling | Compare fraud vs validity proofs in a table |
| Data availability & blobs (EIP-4844) | L2s & rollups | ethereum.org/roadmap/danksharding | Explain what a blob is and why it cut L2 fees |
| L2Beat trust framework | L2s & rollups | l2beat.com | Classify 3 L2s by stage (0/1/2) |
| Account abstraction (ERC-4337) | Account abstraction | erc4337.io | Diagram UserOp → bundler → EntryPoint → paymaster |
| EIP-7702 EOA delegation | Account abstraction | eip.tools/eip/7702 or alchemy.com/blog/eip-7702 | Explain what 7702 changes vs 4337 |
| Pectra & Fusaka deltas | 2025–26 protocol state | ethereum.org/roadmap | List what each fork shipped |

(Expand the table to ~30 leaves by adding the obvious neighbors within each sub-chapter — e.g. "Mnemonics & HD wallets", "Nonce & replay protection", "Reading storage slots", "Slashing & the beacon chain", "Sequencers & batchers", "Bundler economics" — following the same shape. Keep the file ≤40 topics / ≤90 KB or split into `01a`/`01b`.)

- [ ] **Step 1: Write the file.** Author the 7 sub-chapter concept nodes, then every leaf. The four fully-worked exemplars below (copy their exact shape for all remaining leaves):

```json
{
  "version": 2,
  "sessionId": null,
  "reviews": [],
  "proposedTopics": [
    { "title": "Blockchain basics", "type": "concept", "domain": "Web3",
      "description": "What a blockchain is and why it is trustless: linked blocks, hashing, immutability, distributed consensus. Resources: https://updraft.cyfrin.io/courses/blockchain-basics",
      "prerequisiteTitles": [], "parentTitle": "Phase 1 — Blockchain & Ethereum Fundamentals" },
    { "title": "Accounts, transactions & gas", "type": "concept", "domain": "Web3",
      "description": "Ethereum's account model, transaction anatomy, and the gas/fee market. Resources: https://ethereum.org/en/developers/docs/accounts/",
      "prerequisiteTitles": ["Blockchain basics"], "parentTitle": "Phase 1 — Blockchain & Ethereum Fundamentals" },
    { "title": "EVM execution model", "type": "concept", "domain": "Web3",
      "description": "How the EVM executes bytecode: state machine, data locations, opcodes. Resources: https://www.evm.codes/",
      "prerequisiteTitles": ["Accounts, transactions & gas"], "parentTitle": "Phase 1 — Blockchain & Ethereum Fundamentals" },

    { "title": "Public-key cryptography & wallets", "type": "pattern", "domain": "Web3",
      "description": "A wallet is a keypair, not an account of coins: the private key signs, the public key derives the 20-byte address (keccak of the pubkey, last 20 bytes). Losing the key = losing control; there is no reset. Resources: 📖 https://ethereum.org/en/developers/docs/accounts/",
      "aiContext": "Build: run `cast wallet new` in web3-practice; in contracts/phase01/README.md explain, in your own words, how the address is derived from the public key and why the private key must never touch the chain. Done when: you can state the derivation (pubkey → keccak256 → last 20 bytes) without looking.",
      "prerequisiteTitles": [], "parentTitle": "Blockchain basics" },
    { "title": "Transaction anatomy", "type": "pattern", "domain": "Web3",
      "description": "A transaction carries nonce, gasLimit, maxFeePerGas/maxPriorityFeePerGas (EIP-1559), to, value, data, and a signature (v,r,s). The nonce enforces ordering and replay protection; `data` is the ABI-encoded call. Resources: 📖 https://ethereum.org/en/developers/docs/transactions/",
      "aiContext": "Build: pick a real mainnet tx and run `cast tx <hash>` and `cast receipt <hash>` in web3-practice; write contracts/phase01/tx-anatomy.md mapping each field to its purpose. Done when: you can explain why the same signed tx cannot be replayed at a different nonce or chainId.",
      "prerequisiteTitles": ["Public-key cryptography & wallets"], "parentTitle": "Accounts, transactions & gas" },
    { "title": "Gas & the fee market (EIP-1559)", "type": "pattern", "domain": "Web3",
      "description": "Gas prices execution; EIP-1559 splits the price into a burned base fee (set by protocol from block fullness) and a priority tip to the proposer. Under-pricing the max fee means the tx stalls. Resources: 📖 https://ethereum.org/en/developers/docs/gas/",
      "aiContext": "Build: read a recent block's base fee via `cast base-fee`; in contracts/phase01/gas.md work a numeric example of total cost = gasUsed × (baseFee + priorityFee). Done when: you can predict whether a tx with a given maxFeePerGas will include in a block of known base fee.",
      "prerequisiteTitles": ["Transaction anatomy"], "parentTitle": "Accounts, transactions & gas" },
    { "title": "Stack / memory / storage / calldata", "type": "pattern", "domain": "Web3",
      "description": "The EVM's four data locations differ in lifetime and cost: the stack (1024 words, transient), memory (byte-addressed, transient, expansion-priced), storage (persistent, 32-byte slots, expensive), and calldata (read-only tx input, cheapest). Choosing wrong is the root of both bugs and gas waste. Resources: 🔗 https://www.evm.codes/",
      "aiContext": "Build: in contracts/phase01/data-locations.md, tabulate the four locations by lifetime, addressing, and gas cost, with one example use of each. Done when: you can say why a function argument marked `calldata` is cheaper than `memory` for a read-only array.",
      "prerequisiteTitles": [], "parentTitle": "EVM execution model" }
  ],
  "proposedPrompts": [
    { "topicTitle": "Public-key cryptography & wallets",
      "promptText": "How is an Ethereum address derived from a private key, and what is irreversible about it?",
      "answerHint": "privkey → (secp256k1) pubkey → keccak256(pubkey) → last 20 bytes = address. One-way at each step; a lost private key is unrecoverable and there is no admin reset.",
      "promptKind": "concept" },
    { "topicTitle": "Transaction anatomy",
      "promptText": "Name the fields of an EIP-1559 transaction and say which one prevents replay.",
      "answerHint": "nonce, gasLimit, maxFeePerGas, maxPriorityFeePerGas, to, value, data, (v,r,s). The nonce (per-sender, monotonic) plus chainId in the signature prevent replay.",
      "promptKind": "concept" },
    { "topicTitle": "Gas & the fee market (EIP-1559)",
      "promptText": "Break down what a sender pays per gas under EIP-1559, and where each part goes.",
      "answerHint": "base fee (burned, set by protocol from block fullness) + priority tip (to the proposer). Total = gasUsed × (baseFee + tip), capped by maxFeePerGas.",
      "promptKind": "concept" },
    { "topicTitle": "Stack / memory / storage / calldata",
      "promptText": "Order the EVM data locations by gas cost and explain when each is appropriate.",
      "answerHint": "calldata (cheapest, read-only input) < stack < memory (transient scratch, expansion-priced) < storage (persistent, most expensive). Use calldata for read-only args, memory for scratch, storage only for state that must persist.",
      "promptKind": "concept" }
  ],
  "noteSummaries": []
}
```

- [ ] **Step 2: Finish the phase.** Add the remaining Phase-1 sub-chapter nodes and leaves from the table (and the ~13 neighbor leaves) in the same shape: concept-node for each sub-chapter, each leaf with description(CONCEPT+Resources URL) + aiContext(Build+Done-when) + ≥1 concept card.

- [ ] **Step 3: Validate structurally**

Run: `node scripts/validate-web3-content.mjs`
Expected: exit 0, cumulative counts (`00`+`01`) grow, 0 errors. Fix any reported leaf missing a URL, Build/Done-when, or concept card.

- [ ] **Step 4: Live-check URLs**

Run: `node scripts/validate-web3-content.mjs --check-urls 01`
Expected: exit 0, 0 failures.

---

### Tasks 4–13: author the remaining phase files

Each task has the **same three steps** — follow the Task 3 exemplar exactly for structure, the description/aiContext split, resource anchoring, and card phrasing:

- [ ] **Step 1:** Write the file(s): sub-chapter concept nodes + leaves. Every leaf gets description(CONCEPT + `Resources:` URL) + aiContext(`Build:` naming the exact `web3-practice/…` path + `Done when:`) + ≥1 `concept` card; add a `code` card where a "write this" kernel exists and a `problem` card (with `url`) for each linked wargame/CTF/contest exercise. Leaf titles globally unique. Parent = the phase or a sub-chapter node; prereqs reference earlier-sorting files where a real dependency exists (the spec's cross-phase edges).
- [ ] **Step 2:** `node scripts/validate-web3-content.mjs` — exit 0, counts grow, 0 errors.
- [ ] **Step 3:** `node scripts/validate-web3-content.mjs --check-urls NN` — 0 failures.

Split any phase that would exceed 40 topics / 90 KB into `NNa-…`, `NNb-…` (etc.). Source the leaf lists and resource anchors from the spec sections named below.

#### Task 4 — `content/web3/02a-solidity.json` + `02b-solidity.json` (Phase 2, ~45 leaves → 2 files)
Spec section: "Phase 2 — Solidity language, exhaustive". Sub-chapters: Types & data locations · Functions/visibility/modifiers · Storage layout · Inheritance · Events · Errors · ETH transfer (payable/fallback/receive) · Low-level calls (`call`/`delegatecall`/`staticcall`) · ABI encode/decode · Hashing · Signatures (ECDSA/EIP-712) · Libraries/interfaces · Assembly/Yul intro · Transient storage · UDVTs. Primary resource: Updraft *Solidity Smart Contract Development* + every solidity-by-example **basics** page (https://solidity-by-example.org/ — anchor each leaf to its specific SBE page). Builds write `contracts/phase02/<Topic>.sol` + a Foundry test in `test/phase02/`. `02a` = types→events; `02b` = errors→UDVTs.

#### Task 5 — `content/web3/03-tooling.json` (Phase 3, ~30 leaves)
Spec section: "Phase 3 — Tooling: Foundry & Hardhat, exhaustive". Foundry sub-chapter (forge/cast/anvil/chisel · unit/fork/fuzz/invariant testing · cheatcodes · scripting/deploy/verify · gas snapshots · coverage · **dependency/module system**: git submodules, remappings, soldeer, profiles · Slither/Aderyn wiring) and a Hardhat 3 sub-chapter (setup · TS testing · **Ignition deployment** · config/networks · plugins · **Foundry interop** reading `foundry.toml` · when-to-use-which). Resources: https://getfoundry.sh/ (Foundry Book) + https://hardhat.org/docs. Builds target the practice repo's own tooling (`foundry.toml`, `hardhat.config.ts`, `test/`, `deploy/`). Include a `problem` card linking Speedrun Ethereum challenges 0–2 (https://speedrunethereum.com/).

#### Task 6 — `content/web3/04-standards.json` (Phase 4, ~40 leaves; split to `04a`/`04b` if over 90 KB)
Spec section: "Phase 4 — Core contract patterns & standards". Leaves: ERC-20/721/1155/4626 · Transparent/UUPS/Diamond proxies · access-control patterns · pausing/reentrancy guards · signatures/permit/meta-tx · merkle airdrops · multisig · factories/CREATE2/minimal-proxy clones · DAOs/governance. **Security thread starts here:** each standard's aiContext includes a "threat model" line and, where apt, a `problem` card pointing at the matching attack topic's wargame (added in Phase 6). Resources: Updraft *Advanced Foundry*, OpenZeppelin contracts docs, solidity-by-example app examples. Builds write `contracts/phase04/…` + tests.

#### Task 7 — `content/web3/05-gas.json` (Phase 5, ~30 leaves)
Spec section: "Gas catalog" (six families: storage · calldata/memory · control flow · types/layout · assembly/Yul · architecture). Every leaf's Build is a **gas-puzzle** with a numeric target: `Build: solve gas/<name> — beat <N> gas; Done when: forge test + gas snapshot under target.` Resources: RareSkills gas book (https://www.rareskills.io/post/gas-optimization-in-solidity) + gas-puzzles repo (https://github.com/RareSkills/gas-puzzles) + Node Guardians gas quests. Each leaf gets a `code` card.

#### Task 8 — `content/web3/06a-security-methodology.json` (Phase 6 part 1, ~20 leaves)
Spec section: "Phase 6". Audit methodology · reading a codebase · scoping · severity (OWASP SC Top 10 2026, Immunefi classification) · static analysis (Slither, Aderyn) · fuzzing & invariants for security · report writing. Resources: Updraft *Smart Contract Security* (https://updraft.cyfrin.io/courses/security), Trail of Bits building-secure-contracts (https://secure-contracts.com/), Solodit checklist (https://solodit.cyfrin.io/checklist).

#### Task 9 — `content/web3/06b-attacks.json` (Phase 6 part 2, ~35 leaves — the attack taxonomy)
Spec section: "Attack taxonomy" — all 8 families + business-logic chapter. **One leaf per attack class listed in the spec.** Each leaf: description explains the bug + a real incident; aiContext Build = write the exploit that breaks a minimal victim in `security/attacks/<class>/`, then the fix, prove exploit reverts; ≥1 concept card + a `code` card; a `problem` card linking the matching Ethernaut level and/or Damn Vulnerable DeFi v4 challenge and/or a DeFiHackLabs replay. Resources per family from the spec table (Ethernaut https://ethernaut.openzeppelin.com/, DVD https://www.damnvulnerabledefi.xyz/, DeFiVulnLabs/DeFiHackLabs https://github.com/SunWeb3Sec/DeFiHackLabs, solidity-by-example hacks). Split to `06b`/`06c-attacks` if over 90 KB.

#### Task 10 — `content/web3/06d-wargames.json` (Phase 6 part 3, ~15 leaves — judged practice)
Wargame ladders as leaves: Ethernaut (grouped) · Damn Vulnerable DeFi v4 (grouped) · DeFiHackLabs replay set · CodeHawks First Flights (https://codehawks.cyfrin.io/first-flights). Each leaf's Build = solve/replay in the practice repo `security/`; Done-when = solutions committed with a written finding. `problem` cards carry the platform URLs. Milestone: a submitted First Flight finding.

#### Task 11 — `content/web3/07a-defi.json` + `07b-defi.json` (Phase 7, ~50 leaves → 2 files)
Spec section: "Phase 7". `07a` = AMMs (constant-product/sum/stableswap) · Uniswap V2 → V3 → V4/hooks · oracles. `07b` = lending (Aave V3/Compound V3) · stablecoins (CDP, overcollateralized algorithmic, Sky/USDS) · staking/LSTs/restaking · perps · vaults (ERC-4626) · flash loans. **From-scratch Builds:** e.g. `Build: implement contracts/defi/amm/ConstantProduct.sol from scratch; Done when: invariant test proves k never decreases on swaps under fuzzing.` Resources: Jeiwan Programming-DeFi/Uniswap V3 book (https://jeiwan.net/, https://uniswapv3book.com/), RareSkills V2 book (https://www.rareskills.io/uniswap-v2-book), Cyfrin DeFi + advanced-DeFi courses, Finematics for concept intros.

#### Task 12 — `content/web3/08-evm-internals.json` (Phase 8, ~30 leaves)
Spec section: "Phase 8". Opcodes deep · Yul/Huff · storage/memory/calldata at bytecode level · function selectors/dispatch · proxies at bytecode level · formal verification (Halmos/Certora/Kontrol) · optional EVM-from-scratch. Resources: Updraft *Assembly & Formal Verification*, noxx (full), evm.codes, https://github.com/w1nt3r-eth/evm-from-scratch. Builds write assembly-optimized contracts + one FV proof.

#### Task 13 — `content/web3/09-frontier.json` + `10-fullstack.json` (Phases 9 & 10, ~30 + ~20 leaves)
Spec sections: "Phase 9" and "Phase 10". Phase 9: MEV (Flashbots https://docs.flashbots.net/) · intents/ERC-7683 · V4 hooks deep (Atrium) · restaking/EigenLayer · RWAs · ZK (RareSkills ZK book https://www.rareskills.io/zk-book / Noir) · L2 internals (Arbitrum Nitro / OP Stack docs). Phase 10: viem/wagmi · wallet connection · read/write contracts · events/indexing · Scaffold-ETH 2 · finish the Speedrun ladder — Builds write `frontend/`. **After this task**, run the full sweep + coverage check:
```bash
node scripts/validate-web3-content.mjs                 # ~16 files, ~305–365 topics, 0 errors
node scripts/validate-web3-content.mjs --check-urls     # full unique-URL live check, 0 failures
node scripts/validate-web3-content.mjs --check-coverage # 0 gaps (needs coverage.json from Task 13 Step 0)
```

- [ ] **Task 13 Step 0 — write the coverage checklist `content/web3/coverage.json`** (before authoring 09/10, so `--check-coverage` can run at the end). It encodes the spec's coverage guarantee as needles that must appear somewhere in the authored corpus:

```json
{
  "owasp_sc_top10_2026": ["access control", "business logic", "price oracle", "flash loan", "input validation", "unchecked external call", "arithmetic", "reentrancy", "integer overflow", "proxy"],
  "ethernaut_selected": ["fallback", "coinflip", "telephone", "delegation", "force", "re-entrancy", "vault", "privacy", "gatekeeper", "motorbike", "puzzle wallet", "dex"],
  "damn_vulnerable_defi_v4": ["unstoppable", "naive receiver", "truster", "side entrance", "the rewarder", "puppet", "curvy puppet", "withdrawal"],
  "attack_families": ["cross-function reentrancy", "read-only reentrancy", "tx.origin", "uninitialized proxy", "signature replay", "erc-4626", "first-depositor", "sandwich", "storage collision", "selector clash", "force-feeding", "fee-on-transfer"],
  "gas_families": ["storage packing", "warm", "cold", "calldata", "unchecked", "custom errors", "immutable", "bitmap", "minimal proxy", "transient storage"],
  "defi_builds": ["constant product", "stableswap", "uniswap v2", "uniswap v3", "uniswap v4", "aave", "stablecoin", "flash loan", "erc-4626", "eigenlayer"]
}
```

(If a needle legitimately isn't covered because a synonym was used, adjust the needle to the phrase actually authored — the point is that every guaranteed area has a home topic, not the exact wording.)

---

### Task 14: Scaffold the hybrid Foundry + Hardhat practice repo

**Files (new, in a separate git repo — default `~/personal/web3-practice`, confirm the path with the user):**
- Create: `web3-practice/foundry.toml`, `hardhat.config.ts`, `package.json`, `.gitignore`, `README.md`, `remappings.txt`
- Create: `contracts/phase01-fundamentals/.gitkeep` … `contracts/phase10-fullstack/.gitkeep`, `test/.gitkeep`, `deploy/.gitkeep`, `security/.gitkeep`, `defi/.gitkeep`, `gas/.gitkeep`, `frontend/.gitkeep`
- Create: `test/Scaffold.t.sol` (one passing test proving the toolchain)

**Interfaces:**
- Produces: a repo whose directory names match the `web3-practice/…` paths every topic's `Build:` line references. Structure + configs + README index only — no solution code.

- [ ] **Step 1: Create the repo skeleton**

```bash
ROOT="$HOME/personal/web3-practice"       # confirm with user first
mkdir -p "$ROOT"/contracts/phase{01-fundamentals,02-solidity,03-tooling,04-standards,05-gas,06-security,07-defi,08-evm,09-frontier,10-fullstack}
mkdir -p "$ROOT"/{test,deploy,security,defi,gas,frontend,lib}
cd "$ROOT"
for d in contracts/phase* test deploy security defi gas frontend; do : > "$d/.gitkeep"; done
```

- [ ] **Step 2: Write `foundry.toml`**

```toml
[profile.default]
src = "contracts"
test = "test"
out = "out"
libs = ["lib"]
solc = "0.8.26"
optimizer = true
optimizer_runs = 200
fuzz = { runs = 256 }
invariant = { runs = 64, depth = 32 }

[profile.ci]
fuzz = { runs = 1024 }
```

- [ ] **Step 3: Write `package.json` + `hardhat.config.ts` + `remappings.txt`**

`package.json`:
```json
{
  "name": "web3-practice",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "hardhat build",
    "test:forge": "forge test",
    "test:hh": "hardhat test"
  },
  "devDependencies": {
    "hardhat": "^3.0.0",
    "@nomicfoundation/hardhat-toolbox-viem": "^5.0.0",
    "viem": "^2.0.0",
    "typescript": "^5.6.0"
  }
}
```

`hardhat.config.ts` (Hardhat 3 reads Foundry's layout so both chains share `contracts/`):
```ts
import type { HardhatUserConfig } from 'hardhat/config';

const config: HardhatUserConfig = {
  solidity: { version: '0.8.26', settings: { optimizer: { enabled: true, runs: 200 } } },
  paths: { sources: 'contracts', tests: 'test' },
};

export default config;
```

`remappings.txt`:
```
forge-std/=lib/forge-std/src/
```

- [ ] **Step 4: Install Foundry std lib + a passing scaffold test**

```bash
cd "$ROOT"
forge install foundry-rs/forge-std --no-git   # or with git if the repo is initialized
```

`test/Scaffold.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

contract ScaffoldTest is Test {
    function test_toolchain_alive() public pure {
        assertEq(uint256(1) + 1, 2);
    }
}
```

- [ ] **Step 5: Write `README.md` (the phase→topic→path index)**

```markdown
# web3-practice

Hands-on companion to the Terrain **Web3 / Solidity / DeFi** learning path.
Each Terrain topic's `Build:` line names a path here.

## Toolchain
- **Foundry** (primary): `forge test` — unit/fuzz/invariant, all security & gas work.
- **Hardhat 3** (secondary): `npx hardhat build`, `deploy/` — TS deploy pipelines & full-stack. Reads `foundry.toml`.

## Layout
| Path | Phase |
|---|---|
| contracts/phase01-fundamentals | 1 — Fundamentals (mostly notes) |
| contracts/phase02-solidity     | 2 — Solidity language |
| contracts/phase03-tooling      | 3 — Foundry & Hardhat |
| contracts/phase04-standards    | 4 — Standards & patterns |
| gas/                           | 5 — Gas puzzles |
| security/                      | 6 — Attacks, wargames, replays |
| defi/                          | 7 — From-scratch DeFi builds |
| contracts/phase08-evm          | 8 — EVM internals |
| contracts/phase09-frontier     | 9 — MEV/ZK/L2 |
| frontend/                      | 10 — Full-stack dApp |
| test/                          | Foundry tests |
| deploy/                        | Hardhat Ignition / TS deploy |
```

- [ ] **Step 6: Prove both chains build**

```bash
cd "$ROOT"
forge build && forge test          # ScaffoldTest passes
npm install && npx hardhat build   # Hardhat compiles the same contracts/ tree
git init && git add -A && git commit -m "chore: scaffold web3-practice (Foundry + Hardhat 3)"
```
Expected: `forge test` shows 1 passing test; `hardhat build` compiles with no errors. (This repo is committed — it's separate from Terrain.)

---

### Task 15: Import script `scripts/import-web3.mjs`

**Files:**
- Create: `scripts/import-web3.mjs`

**Interfaces:**
- Consumes: `loadContentFiles`, `structuralErrors`, `norm` from `scripts/lib/web3-content.mjs` (Task 1).
- Produces: CLI — `node scripts/import-web3.mjs [--dry-run] [--from NN] [--verify-only]`. Env: `TERRAIN_API` (default `http://localhost:3000`), `TERRAIN_EMAIL`, `TERRAIN_PASSWORD`, `TERRAIN_NAME` (first-time registration only).

- [ ] **Step 1: Write the script** (structure mirrors `scripts/import-dsa.mjs`; differences: web3 lib import, `domain === 'Web3'` filter, no problem-card url/difficulty/estimate assertion in verify since web3 problem cards need only `url`):

```js
// Preview-gated import of content/web3 into the user's real account.
//   node scripts/import-web3.mjs [--dry-run] [--from NN] [--verify-only]
// Env: TERRAIN_API (default http://localhost:3000), TERRAIN_EMAIL,
//      TERRAIN_PASSWORD, TERRAIN_NAME (used only if registration is needed).
import { loadContentFiles, structuralErrors, norm } from './lib/web3-content.mjs';

const API = process.env.TERRAIN_API ?? 'http://localhost:3000';
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const VERIFY_ONLY = args.includes('--verify-only');
const FROM = args.includes('--from') ? args[args.indexOf('--from') + 1] : '00';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const die = (msg) => {
  console.error(`FATAL: ${msg}`);
  process.exit(1);
};

let cookie = '';
async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', cookie, ...init.headers },
  });
  const setCookie = res.headers.getSetCookie?.()[0];
  if (setCookie) cookie = setCookie.split(';')[0];
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, body };
}

async function login() {
  const { TERRAIN_EMAIL: email, TERRAIN_PASSWORD: password, TERRAIN_NAME: name } = process.env;
  if (!email || !password) die('set TERRAIN_EMAIL and TERRAIN_PASSWORD');
  let r = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (r.status === 401 || r.status === 404) {
    if (!name) die(`login failed (${r.status}) and TERRAIN_NAME not set for registration`);
    console.log(`login failed (${r.status}) — registering ${email}`);
    r = await api('/auth/register', { method: 'POST', body: JSON.stringify({ email, password, name }) });
  }
  if (r.status >= 300) die(`auth failed: ${r.status} ${JSON.stringify(r.body)}`);
  console.log(`authenticated as ${email}`);
}

async function importFile({ file, doc }) {
  const exp = await api('/sessions/export');
  if (exp.status !== 200 || !exp.body?.id) die(`${file}: export mint failed ${exp.status}`);
  const raw = '```learning-os\n' + JSON.stringify({ ...doc, sessionId: exp.body.id }) + '\n```';

  const prev = await api('/sessions/import/preview', { method: 'POST', body: JSON.stringify({ raw }) });
  if (prev.status !== 200) die(`${file}: preview failed ${prev.status} ${JSON.stringify(prev.body)}`);
  const plan = prev.body;
  const toCreate = plan.newTopics.filter((t) => !t.alreadyExists);
  console.log(
    `${file}: preview — ${toCreate.length}/${plan.newTopics.length} topics to create, ` +
      `${plan.newPrompts.length} cards, ${plan.unresolved.length} unresolved`,
  );
  if (plan.unresolved.length > 0) die(`${file}: unresolved refs:\n${JSON.stringify(plan.unresolved, null, 2)}`);
  if (toCreate.length === 0) {
    console.log(`${file}: all topics already exist — SKIPPING (already imported)`);
    return { skipped: true };
  }
  if (toCreate.length !== doc.proposedTopics.length)
    die(`${file}: PARTIAL overlap — ${doc.proposedTopics.length - toCreate.length} topics already exist; resolve manually`);
  if (plan.newPrompts.length !== doc.proposedPrompts.length)
    die(`${file}: preview plans ${plan.newPrompts.length} cards, file has ${doc.proposedPrompts.length}`);
  if (DRY) return { dryRun: true };

  const res = await api('/sessions/import', { method: 'POST', body: JSON.stringify({ raw }) });
  if (res.status >= 300) die(`${file}: apply failed ${res.status} ${JSON.stringify(res.body)}`);
  console.log(`${file}: APPLIED — ${JSON.stringify(res.body)}`);
  return { applied: true };
}

async function verify(files) {
  const list = await api('/topics');
  if (list.status !== 200) die(`verify: GET /topics failed ${list.status}`);
  const web3 = list.body.filter((t) => t.domain === 'Web3');
  const expectedTopics = files.flatMap((f) => f.doc.proposedTopics);
  const byTitle = new Map(web3.map((t) => [norm(t.title), t]));
  let fail = 0;
  const bad = (msg) => (console.error(`VERIFY FAIL: ${msg}`), fail++);

  if (web3.length !== expectedTopics.length) bad(`expected ${expectedTopics.length} Web3 topics, found ${web3.length}`);
  const cardsByTitle = new Map();
  for (const f of files)
    for (const p of f.doc.proposedPrompts)
      cardsByTitle.set(norm(p.topicTitle), (cardsByTitle.get(norm(p.topicTitle)) ?? 0) + 1);
  let expectedEdges = 0;
  for (const t of expectedTopics) {
    const row = byTitle.get(norm(t.title));
    if (!row) {
      bad(`missing topic "${t.title}"`);
      continue;
    }
    expectedEdges += new Set(t.prerequisiteTitles.map(norm)).size;
    const expectedCards = cardsByTitle.get(norm(t.title)) ?? 0;
    if (t.type === 'pattern' && row.prompts?.length !== expectedCards)
      bad(`"${t.title}": ${row.prompts?.length} cards, expected ${expectedCards}`);
  }
  const actualEdges = web3.reduce((n, t) => n + (t.prerequisiteIds?.length ?? 0), 0);
  if (actualEdges !== expectedEdges) bad(`prereq edges: ${actualEdges}, expected ${expectedEdges}`);

  const leaves = expectedTopics.filter((t) => t.type === 'pattern');
  console.log(`sweeping ${leaves.length} leaves for autoGenerated/field checks (paced)...`);
  for (const t of leaves) {
    const row = byTitle.get(norm(t.title));
    if (!row) continue;
    const detail = await api(`/topics/${row.id}`);
    if (detail.status !== 200) {
      bad(`GET /topics/${row.id} -> ${detail.status}`);
      continue;
    }
    for (const p of detail.body.prompts ?? []) {
      if (p.autoGenerated) bad(`"${t.title}": autoGenerated starter card ${p.id} exists`);
      if (p.promptKind === 'problem' && !p.url) bad(`"${t.title}": problem card ${p.id} missing url`);
    }
    await sleep(650);
  }
  console.log(fail === 0 ? 'VERIFY OK' : `VERIFY: ${fail} failures`);
  if (fail > 0) process.exit(1);
}

const files = await loadContentFiles();
const errs = structuralErrors(files);
if (errs.length > 0) die(`structural errors — run validate-web3-content.mjs:\n${errs.join('\n')}`);
await login();
if (!VERIFY_ONLY) {
  for (const f of files) {
    if (f.file < FROM) continue;
    await importFile(f);
    await sleep(650);
  }
}
if (!DRY) await verify(files);
```

- [ ] **Step 2: Sanity-check without credentials**

Run: `node scripts/import-web3.mjs --dry-run`
Expected: `FATAL: set TERRAIN_EMAIL and TERRAIN_PASSWORD` (exit 1) — proves arg parsing, file load, and the structural gate run before any network call.

- [ ] **Step 3: Lint/format**

Run: `yarn lint && yarn format:check` — clean. Leave uncommitted.

---

### Task 16: Execute the import against the local stack and verify

**Files:**
- Modify: `.superpowers/sdd/progress.md` (append a ledger section at the end)

- [ ] **Step 1: Stack up**

```bash
docker compose up -d
yarn build
lsof -ti:3000 && kill -9 $(lsof -ti:3000)   # clear any zombie API first
yarn workspace @terrain/api start &          # wait for "Terrain API listening on :3000"
```

- [ ] **Step 2: Get credentials from the user (HUMAN GATE)**

Ask the user to export the real-account env vars themselves (do NOT invent or hardcode credentials):
```bash
export TERRAIN_EMAIL='<terrain-email>' TERRAIN_PASSWORD='<user-provided>' TERRAIN_NAME='<terrain-name>'
```

- [ ] **Step 3: Full validation + dry run**

```bash
node scripts/validate-web3-content.mjs                 # ~16 files, ~305–365 topics, 0 errors
node scripts/validate-web3-content.mjs --check-coverage # 0 gaps
node scripts/import-web3.mjs --dry-run                  # every file: preview OK, 0 unresolved
```

- [ ] **Step 4: Real import + verify**

Run: `node scripts/import-web3.mjs`
Expected: one `APPLIED` line per file, then the verify sweep ends `VERIFY OK`. On a mid-run failure, fix the cause and re-run — applied files self-skip (`all topics already exist — SKIPPING`); resume mid-way with `--from NN`.

- [ ] **Step 5: Eyeball the roadmap UI**

`yarn workspace @terrain/web dev &`, then per `docs/ops/local-dev.md` drive Brave headless via CDP (the `scripts/smoke.mjs` pattern): log in as the real account, filter the roadmap/graph to `domain: Web3`, confirm a single-root 10-phase DAG renders with no orphans/cycles, and a leaf's detail panel shows its authored cards (concept/code/problem kinds, no starter card) plus the Build/Done-when text. Screenshot for the user.

- [ ] **Step 6: Ledger**

Append to `.superpowers/sdd/progress.md`: date `2026-07-07`, and "Web3 curriculum imported: ~16 files, N topics, M cards into <email>'s account via scripts/import-web3.mjs; validation + coverage + verify green; content in content/web3/, practice repo at ~/personal/web3-practice." Run `yarn lint && yarn format:check` one final time. Leave the Terrain working tree uncommitted; remind the user it holds: `content/web3/` (~16 files + coverage.json), `scripts/lib/web3-content.mjs`, `scripts/validate-web3-content.mjs`, `scripts/import-web3.mjs`, the spec, this plan, and the ledger update — plus the separate committed `web3-practice` repo.

---

## Self-Review

**Spec coverage:**
- Approach B / 10 phases / ~305–365 topics → Tasks 2–13 (root + one authoring task per phase). ✓
- Code-first content model (CONCEPT/RESOURCES/BUILD/DONE-WHEN/PROMPTS) → Global Constraints "five-part content model → field mapping" + enforced by the validator (Task 1) + demonstrated in the Task 3 exemplar. ✓
- Exhaustive attack taxonomy → Task 9; gas catalog → Task 7; both pinned by `coverage.json` (Task 13 Step 0) + `--check-coverage` (Task 1, Task 16 Step 3). ✓
- Dual-toolchain Foundry+Hardhat → Task 5 (tooling topics) + Task 14 (hybrid repo scaffold, both chains build). ✓
- Milestone projects → carried in each phase's leaves' Build lines + the wargame/First-Flight `problem` cards (Tasks 9–13); repo dirs exist (Task 14). ✓
- Content-only delivery, no API/schema/seed change → whole plan; reuses concept/pattern types + `/sessions/import` flow (Tasks 15–16), mirrors DSA. ✓
- Extensibility (living-roadmap prompting) → recorded in the root topic's aiContext (Task 2); no code needed. ✓
- Verification section (Web3 DAG, cross-phase edges, wargame/OWASP coverage, repo builds, five-part topics) → validator coverage check + Task 16 Step 5 UI eyeball + Task 14 Step 6 dual build. ✓

**Placeholder scan:** the per-phase authoring Tasks 4–13 intentionally use topic **tables + spec-section references + resource-anchor URL sets** rather than ~350 inlined JSON blobs — this mirrors the in-repo DSA plan precedent (which fully inlined file 01 then drove files 02–18 from tables) and is the established pattern the writing-plans skill says to follow in an existing codebase. The mechanics (lib, validator, scaffold, import script, configs) are fully inlined with complete code. Each authoring task still has concrete exit gates (structural + URL + coverage validators), so "done" is machine-checkable, not vibes.

**Type/name consistency:** `loadContentFiles`/`structuralErrors`/`norm`/`allUrls`/`CONTENT_DIR` are defined in Task 1 and consumed by name in Tasks 15–16; the validator flags `--check-urls`/`--check-coverage`/`--dir` match between Task 1's CLI and their invocations in Tasks 3–13/16; `domain: "Web3"`, `type: "concept"|"pattern"`, and the `problem`-card-needs-`url` rule are consistent across the constraints, the validator, the exemplar, and the import verify. File-naming `^\d\d[a-z]?-.*\.json$` matches the split-file names used throughout (`06a-…`, `07b-…`).
