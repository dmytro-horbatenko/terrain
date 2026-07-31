# DSA Curriculum Content Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author the 100-topic NeetCode DSA curriculum as 18 `content/dsa/*.json` v2 learning-os files (~300–350 cards) and land it in the user's real account via a preview-gated import script against `/sessions/import`.

**Architecture:** Content lives in `content/dsa/` (one file per category, import-ordered). A shared lib (`scripts/lib/dsa-content.mjs`) loads and structurally validates the files; `scripts/validate-dsa-content.mjs` is its CLI plus a LeetCode-GraphQL URL/difficulty checker; `scripts/import-dsa.mjs` logs in, mints a SessionExport per file, previews, gates, applies, and verifies. No API or web code changes.

**Tech Stack:** Node 24 `.mjs` scripts (repo root, `import.meta.dirname`), `@terrain/types` (`learningOsV2Schema`) via the root `node_modules` workspace symlink, plain `fetch`.

**Spec:** `docs/superpowers/specs/2026-07-02-dsa-curriculum-import-design.md`
**Source data:** `apps/api/scripts-tmp/dsa-content.json` (100 topics; leaf descriptions end with a prose `Problems: …` list). Read the whole file before authoring a category — topics are copied from it verbatim except for the trim rule below.

## Global Constraints

- **NO git commits.** Repo policy: work stays uncommitted unless the user explicitly asks. Every "commit" habit from the executing skill is replaced by "leave in working tree".
- `yarn build` must have been run at least once (validator imports `@terrain/types` from `dist/`). If `node_modules/@terrain/types/dist/index.js` is missing, run `yarn workspace @terrain/types build`.
- API runs on `http://localhost:3000`, **no `/api` prefix** (the web proxy strips it; scripts talk to :3000 directly).
- Rate limit: global 100 req/min throttle — any script loop over many endpoints must pace itself (650 ms between calls is safe).
- Contract caps (enforced by `learningOsV2Schema`): ≤200 proposedTopics, ≤500 proposedPrompts per file; promptText/answerHint ≤2000 chars; estimatedMinutes 1–240.
- Titles are identity: every `topicTitle`/`parentTitle`/`prerequisiteTitles` string must match its topic's `title` **exactly as written in the source JSON** (resolution is trim+lowercase, but don't rely on it — copy verbatim).

### Content conventions (every authoring task follows these)

**File shape** — each `content/dsa/NN-<slug>.json` is one JSON object:

```json
{
  "version": 2,
  "sessionId": null,
  "reviews": [],
  "proposedTopics": [ { "title": "...", "type": "concept|pattern", "domain": "DSA", "description": "...", "prerequisiteTitles": [], "parentTitle": "..." } ],
  "proposedPrompts": [ { "topicTitle": "...", "promptText": "...", "answerHint": "...", "promptKind": "concept|code|problem", "url": "...", "problemDifficulty": "easy|medium|hard", "estimatedMinutes": 30 } ],
  "noteSummaries": []
}
```

`sessionId` stays `null` in the file — the import script stamps a real export id at import time. `url`/`problemDifficulty`/`estimatedMinutes` appear **only** on `problem` cards (schema is `.strict()` but these are optional — just omit them on concept/code cards).

**Topics:** copy the category's concept topic + its pattern leaves from `apps/api/scripts-tmp/dsa-content.json` (title, type, domain, description, prerequisiteTitles, parentTitle, aiContext-if-present) with ONE edit: **delete the trailing `\nProblems: …` sentence from every leaf description** (problems become cards; recognition prose stays). Concept topics' descriptions are unchanged.

**Card templates:**

- `concept` (1 per leaf, always): `promptText`: `"When do you reach for <pattern>? Name the problem-statement signals, and the classic pitfall."` (adapt phrasing to the leaf). `answerHint`: the recognition cues from the leaf description + one concrete pitfall (off-by-one, wrong invariant, missed edge case). Problems the leaf's prose mentioned that did NOT become cards (reserved elsewhere, premium-skipped) may be name-dropped here as "related: …".
- `code` (1 per leaf unless the task's table says `code: skip`): `promptText`: `"Write the <kernel> in your language of choice: <one-line spec from the task table>."` `answerHint`: the loop structure / invariants in prose or pseudocode — **language-neutral, never library- or syntax-specific**.
- `problem` (per the task's table): `promptText`: `"Solve: <Title> (<Difficulty>) — <one-line restatement of the task>."` `answerHint`: the key insight in one sentence (the "aha", not the full solution). Plus `url`, `problemDifficulty`, `estimatedMinutes` exactly as tabled.

**estimatedMinutes heuristic:** easy 15, medium 30, hard 45 — the tables already encode this (plus nudges like N-Queens 60).

**URLs:** LeetCode URLs are `https://leetcode.com/problems/<slug>/` — the tables give full URLs. Six premium problems use free NeetCode pages (exact URLs in the tables). If the URL check in a task's final step flags a slug, find the correct one on the site and fix the file — do not delete the card.

**Dedupe (already applied in the tables):** a problem is a card on exactly ONE leaf in the whole curriculum. The tables are the canonical assignment; never add a problem card for a title that another task's table owns. Cross-file reservations that affect multiple tasks: Two Sum→01, Two Sum II→02, Sort Colors→02, Subarray Sum Equals K→01(Prefix sums), Kth Largest Element in an Array→09, Top K Frequent Elements→09, Merge k Sorted Lists→09, Task Scheduler→09, Meeting Rooms→16, Merge Intervals→16, Non-overlapping Intervals→15, Course Schedule→10(Topological sort), Cheapest Flights Within K Stops→12(Bellman-Ford), Unique Paths→14, Word Break→13.
**Skipped entirely (no free host / not on LeetCode):** Group Shifted Strings, Employee Free Time, Max Stack, Design Search Autocomplete System, Optimize Water Distribution in a Village, One Edit Distance, Serialize and Deserialize N-ary Tree, Matrix Chain Multiplication, Detect Cycle in a Directed Graph, Word Break II. These may only appear as "related:" mentions in hints.

**Validation loop per authoring task:** after writing the file run both:

```bash
node scripts/validate-dsa-content.mjs            # structural, all files so far
node scripts/validate-dsa-content.mjs --check-urls NN   # URL+difficulty check, this file only
```

Both must exit 0 before the task is done.

---

### Task 1: Shared content lib + validator CLI

**Files:**
- Create: `scripts/lib/dsa-content.mjs`
- Create: `scripts/validate-dsa-content.mjs`

**Interfaces:**
- Produces: `loadContentFiles(dir) -> Promise<Array<{ file: string, doc: LearningOsV2 }>>` (throws on JSON/schema errors) and `structuralErrors(files) -> string[]` from `scripts/lib/dsa-content.mjs`; both consumed by Task 20's import script. CLI exit code 0 = valid.

- [ ] **Step 1: Write `scripts/lib/dsa-content.mjs`**

```js
// Shared loader + structural checks for content/dsa/*.json (learning-os v2).
// Used by validate-dsa-content.mjs (CLI) and import-dsa.mjs (pre-flight).
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { learningOsV2Schema } from '@terrain/types';

export const CONTENT_DIR = path.resolve(import.meta.dirname, '../../content/dsa');
export const norm = (s) => s.trim().toLowerCase();

export async function loadContentFiles(dir = CONTENT_DIR) {
  const names = (await readdir(dir)).filter((n) => /^\d\d-.*\.json$/.test(n)).sort();
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
  const seenUrls = new Map(); // url -> `file/topicTitle`
  for (const { file, doc } of files) {
    const local = new Map(doc.proposedTopics.map((t) => [norm(t.title), t]));
    for (const t of doc.proposedTopics) {
      if (seenTitles.has(norm(t.title)))
        errors.push(`${file}: duplicate topic "${t.title}" (also in ${seenTitles.get(norm(t.title))})`);
      if (/Problems:/.test(t.description ?? ''))
        errors.push(`${file}: "${t.title}" description still contains the prose "Problems:" list`);
      const resolvable = (ref) => seenTitles.has(norm(ref)) || local.has(norm(ref));
      if (t.parentTitle && !resolvable(t.parentTitle))
        errors.push(`${file}: "${t.title}" parent "${t.parentTitle}" not in this or an earlier file`);
      for (const pre of t.prerequisiteTitles)
        if (!resolvable(pre))
          errors.push(`${file}: "${t.title}" prereq "${pre}" not in this or an earlier file`);
    }
    const carded = new Set(doc.proposedPrompts.map((p) => norm(p.topicTitle)));
    for (const p of doc.proposedPrompts) {
      const target = local.get(norm(p.topicTitle));
      if (!target) errors.push(`${file}: prompt targets "${p.topicTitle}" — not a topic in the SAME file (starter-card rule)`);
      else if (target.type !== 'pattern')
        errors.push(`${file}: prompt targets non-pattern topic "${p.topicTitle}"`);
      if (p.promptKind === 'problem') {
        if (!p.url || !p.problemDifficulty || !p.estimatedMinutes)
          errors.push(`${file}: problem card on "${p.topicTitle}" missing url/difficulty/estimate`);
        if (p.url) {
          if (seenUrls.has(p.url))
            errors.push(`${file}: duplicate problem url ${p.url} (also carded at ${seenUrls.get(p.url)})`);
          seenUrls.set(p.url, `${file}/${p.topicTitle}`);
        }
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
      errors.push(`${file}: fenced payload ${Buffer.byteLength(fenced)} bytes — over the 90KB safety margin`);
    for (const t of doc.proposedTopics) seenTitles.set(norm(t.title), file);
  }
  return errors;
}
```

- [ ] **Step 2: Write `scripts/validate-dsa-content.mjs`**

```js
// CLI: structural validation of content/dsa (always) + optional LeetCode
// URL/difficulty verification. Usage:
//   node scripts/validate-dsa-content.mjs [--dir <path>] [--check-urls [NN]]
import { loadContentFiles, structuralErrors, CONTENT_DIR } from './lib/dsa-content.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : (args[i + 1]?.startsWith('--') ? true : (args[i + 1] ?? true));
};
const dir = typeof flag('--dir') === 'string' ? flag('--dir') : CONTENT_DIR;
const checkUrls = flag('--check-urls'); // true | 'NN' | undefined
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
  const scope = typeof checkUrls === 'string' ? files.filter((f) => f.file.startsWith(checkUrls)) : files;
  const problems = scope.flatMap((f) =>
    f.doc.proposedPrompts
      .filter((p) => p.promptKind === 'problem')
      .map((p) => ({ file: f.file, topic: p.topicTitle, url: p.url, difficulty: p.problemDifficulty })),
  );
  let bad = 0;
  for (const p of problems) {
    const lc = p.url.match(/^https:\/\/leetcode\.com\/problems\/([^/]+)\/?$/);
    if (!lc) {
      console.log(`MANUAL-CHECK (non-LeetCode): ${p.url} [${p.file}]`);
      continue;
    }
    const res = await fetch('https://leetcode.com/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: 'query($slug:String!){question(titleSlug:$slug){title difficulty}}',
        variables: { slug: lc[1] },
      }),
    });
    const q = (await res.json())?.data?.question;
    if (!q) {
      console.error(`URL FAIL: ${p.url} — no such slug [${p.file}/${p.topic}]`);
      bad++;
    } else if (q.difficulty.toLowerCase() !== p.difficulty) {
      console.error(`DIFFICULTY FAIL: ${p.url} is ${q.difficulty}, card says ${p.difficulty} [${p.file}]`);
      bad++;
    }
    await sleep(250);
  }
  console.log(`${problems.length} problem urls checked, ${bad} failures`);
  if (bad > 0) process.exit(1);
}
```

- [ ] **Step 3: Verify against fixtures (no content exists yet)**

```bash
mkdir -p "$SCRATCH/dsa-fixtures" && cd /path/to/consistency
cat > "$SCRATCH/dsa-fixtures/01-good.json" << 'EOF'
{ "version": 2, "sessionId": null, "reviews": [],
  "proposedTopics": [
    { "title": "Root", "type": "concept", "domain": "DSA", "description": "root", "prerequisiteTitles": [], "parentTitle": null },
    { "title": "Leaf", "type": "pattern", "domain": "DSA", "description": "leaf", "prerequisiteTitles": [], "parentTitle": "Root" } ],
  "proposedPrompts": [
    { "topicTitle": "Leaf", "promptText": "When do you reach for Leaf?", "answerHint": "cues", "promptKind": "concept" } ],
  "noteSummaries": [] }
EOF
cat > "$SCRATCH/dsa-fixtures/02-bad.json" << 'EOF'
{ "version": 2, "sessionId": null, "reviews": [],
  "proposedTopics": [
    { "title": "Orphan", "type": "pattern", "domain": "DSA", "description": "Problems: leftover prose.", "prerequisiteTitles": ["Nowhere"], "parentTitle": "Missing" } ],
  "proposedPrompts": [
    { "topicTitle": "Elsewhere", "promptText": "x", "promptKind": "problem" } ],
  "noteSummaries": [] }
EOF
node scripts/validate-dsa-content.mjs --dir "$SCRATCH/dsa-fixtures"
```

(`$SCRATCH` = the session scratchpad directory.) Expected: exit 1 with STRUCTURAL errors for `02-bad.json` — leftover `Problems:` prose, unresolvable parent "Missing" and prereq "Nowhere", prompt targeting "Elsewhere" (not in same file), problem card missing url/difficulty/estimate, leaf "Orphan" without a concept card. Delete `02-bad.json`, re-run with `--dir` — expected: exit 0, `1 files, 2 topics, 1 cards — 0 structural errors`.

- [ ] **Step 4: Lint/format the new scripts**

Run: `yarn lint && yarn format:check` — expected clean (run `yarn format` if oxfmt complains). Leave uncommitted.

---

### Task 2: `content/dsa/01-arrays-hashing.json` (exemplar — sets the quality bar)

**Files:**
- Create: `content/dsa/01-arrays-hashing.json`

**Interfaces:**
- Produces: the file itself + the authoring pattern every later task imitates. Topics: root `Data Structures & Algorithms` + category `Arrays & Hashing` + 5 leaves, copied from `apps/api/scripts-tmp/dsa-content.json` with the `Problems:` trim.

Card plan (12 problem + 5 concept + 4 code = 21 cards):

| Leaf | code kernel | Problem cards (difficulty, minutes, URL) |
|---|---|---|
| Hashing fundamentals | frequency-count map over an array | Contains Duplicate (easy, 15, https://leetcode.com/problems/contains-duplicate/) · Valid Anagram (easy, 15, https://leetcode.com/problems/valid-anagram/) · Longest Consecutive Sequence (medium, 30, https://leetcode.com/problems/longest-consecutive-sequence/) |
| Two Sum / complement lookup | single-pass complement lookup with a seen-map | Two Sum (easy, 15, https://leetcode.com/problems/two-sum/) · 4Sum II (medium, 30, https://leetcode.com/problems/4sum-ii/) |
| Grouping by key | bucket-by-derived-key loop (map of key → list) | Group Anagrams (medium, 30, https://leetcode.com/problems/group-anagrams/) · Encode and Decode Strings (medium, 30, https://neetcode.io/problems/string-encode-and-decode) |
| Prefix sums | build prefix array + answer a range-sum query in O(1) | Range Sum Query - Immutable (easy, 15, https://leetcode.com/problems/range-sum-query-immutable/) · Subarray Sum Equals K (medium, 30, https://leetcode.com/problems/subarray-sum-equals-k/) · Product of Array Except Self (medium, 30, https://leetcode.com/problems/product-of-array-except-self/) |
| Sorting-based array tricks | **skip** (no single kernel) | Merge Sorted Array (easy, 15, https://leetcode.com/problems/merge-sorted-array/) · Largest Number (medium, 30, https://leetcode.com/problems/largest-number/) |

Reserved elsewhere (hint-mention only): Top K Frequent Elements→09, Two Sum II→02, Subarray Sum Equals K is carded on Prefix sums not Two Sum/complement, Sort Colors→02, Kth Largest→09, Meeting Rooms→16, Merge Intervals→16. Group Shifted Strings is premium-skipped. Sorting-based leaf's prose picks were all reserved, so it gets two plan-chosen substitutes (Merge Sorted Array, Largest Number) that exercise "sort first unlocks the trick".

- [ ] **Step 1: Write the file.** Complete content (this exact JSON, exemplar for all later tasks):

```json
{
  "version": 2,
  "sessionId": null,
  "reviews": [],
  "proposedTopics": [
    {
      "title": "Data Structures & Algorithms",
      "type": "concept",
      "domain": "DSA",
      "description": "Root of the DSA learning path. Structure: NeetCode roadmap category order, each split into reviewable sub-patterns (the actual scheduling unit), each with curated problems from NeetCode 150 / Blind 75. Prereq edges follow real conceptual dependency, not just roadmap position. Study one sub-pattern at a time; drill into individual problems only when reviewing that sub-pattern.",
      "prerequisiteTitles": [],
      "parentTitle": null,
      "aiContext": "path root, created 2026-07-01; cards authored 2026-07-02"
    },
    {
      "title": "Arrays & Hashing",
      "type": "concept",
      "domain": "DSA",
      "description": "Foundation category: hash-based lookup and array manipulation underlie most other patterns. No DSA prereqs — entry point.",
      "prerequisiteTitles": [],
      "parentTitle": "Data Structures & Algorithms"
    },
    {
      "title": "Hashing fundamentals",
      "type": "pattern",
      "domain": "DSA",
      "description": "Use a hash set/map to turn an O(n) membership or lookup check into O(1). Recognize: \"have I seen this before\", \"does X exist\", frequency counts.",
      "prerequisiteTitles": [],
      "parentTitle": "Arrays & Hashing"
    },
    {
      "title": "Two Sum / complement lookup",
      "type": "pattern",
      "domain": "DSA",
      "description": "For each element, check whether its complement (target - x) was already seen; store as you go instead of nested-looping. Recognize: \"pair that sums/multiplies to X\", single pass with a map.",
      "prerequisiteTitles": ["Hashing fundamentals"],
      "parentTitle": "Arrays & Hashing"
    },
    {
      "title": "Grouping by key",
      "type": "pattern",
      "domain": "DSA",
      "description": "Bucket elements by a derived key (sorted string, character-count signature) into a hash map of lists. Recognize: \"group these into categories\", anagram/shape clustering.",
      "prerequisiteTitles": ["Hashing fundamentals"],
      "parentTitle": "Arrays & Hashing"
    },
    {
      "title": "Prefix sums",
      "type": "pattern",
      "domain": "DSA",
      "description": "Precompute running sums so any range sum is O(1) via subtraction; combine with a hash map of seen prefix sums for subarray-sum problems. Recognize: repeated range-sum queries, \"subarray with sum equal to X\".",
      "prerequisiteTitles": ["Hashing fundamentals"],
      "parentTitle": "Arrays & Hashing"
    },
    {
      "title": "Sorting-based array tricks",
      "type": "pattern",
      "domain": "DSA",
      "description": "Sort first to unlock two-pointer scans, deduplication, or greedy choices that only work on ordered data. Recognize: problem becomes easy once sorted, needs original-vs-sorted comparison.",
      "prerequisiteTitles": ["Hashing fundamentals"],
      "parentTitle": "Arrays & Hashing"
    }
  ],
  "proposedPrompts": [
    {
      "topicTitle": "Hashing fundamentals",
      "promptText": "When do you reach for a hash set/map as the core of a solution? Name the problem-statement signals, and the classic pitfall.",
      "answerHint": "Signals: \"have I seen this before\", \"does X exist\", frequency counting, any O(n^2) membership scan you can make O(n). Pitfall: hashing mutable/unnormalized keys (forgetting to sort or canonicalize the thing you look up). Related: Top K Frequent Elements builds a frequency map first.",
      "promptKind": "concept"
    },
    {
      "topicTitle": "Hashing fundamentals",
      "promptText": "Write a frequency counter in your language of choice: given an array, build a map value -> count in one pass, then use it to find any value appearing exactly twice.",
      "answerHint": "One loop, map.get(x) defaulting to 0 then +1; second loop (or the same one) checks counts. Invariant: after i iterations the map holds exact counts for the first i elements.",
      "promptKind": "code"
    },
    {
      "topicTitle": "Hashing fundamentals",
      "promptText": "Solve: Contains Duplicate (Easy) — return true if any value appears at least twice in the array.",
      "answerHint": "Set of seen values; return true the moment insertion finds the value already present.",
      "promptKind": "problem",
      "url": "https://leetcode.com/problems/contains-duplicate/",
      "problemDifficulty": "easy",
      "estimatedMinutes": 15
    },
    {
      "topicTitle": "Hashing fundamentals",
      "promptText": "Solve: Valid Anagram (Easy) — given two strings, return true if one is an anagram of the other.",
      "answerHint": "Character-frequency map of s, decrement over t; all zeros means anagram (or compare two count maps).",
      "promptKind": "problem",
      "url": "https://leetcode.com/problems/valid-anagram/",
      "problemDifficulty": "easy",
      "estimatedMinutes": 15
    },
    {
      "topicTitle": "Hashing fundamentals",
      "promptText": "Solve: Longest Consecutive Sequence (Medium) — length of the longest run of consecutive integers in an unsorted array, in O(n).",
      "answerHint": "Hash-set all values; only start counting from numbers whose predecessor (x-1) is absent — each element is visited at most twice.",
      "promptKind": "problem",
      "url": "https://leetcode.com/problems/longest-consecutive-sequence/",
      "problemDifficulty": "medium",
      "estimatedMinutes": 30
    },
    {
      "topicTitle": "Two Sum / complement lookup",
      "promptText": "When do you reach for the complement-lookup pattern? Name the problem-statement signals, and the classic pitfall.",
      "answerHint": "Signals: \"pair summing/multiplying to X\", single unsorted pass where sorting would cost the indices. Pitfall: inserting the current element BEFORE checking its complement (breaks on target = 2x). Related: Two Sum II (sorted input) belongs to opposite-direction pointers; Subarray Sum Equals K is the same idea on prefix sums.",
      "promptKind": "concept"
    },
    {
      "topicTitle": "Two Sum / complement lookup",
      "promptText": "Write the single-pass complement lookup in your language of choice: given an array and target, return the indices of a pair summing to target.",
      "answerHint": "Map value -> index built as you scan; check map for (target - x) before inserting x. Invariant: map only ever holds elements strictly left of the cursor.",
      "promptKind": "code"
    },
    {
      "topicTitle": "Two Sum / complement lookup",
      "promptText": "Solve: Two Sum (Easy) — indices of the two numbers adding to target, one valid answer guaranteed.",
      "answerHint": "Check seen-map for complement, then store current value -> index.",
      "promptKind": "problem",
      "url": "https://leetcode.com/problems/two-sum/",
      "problemDifficulty": "easy",
      "estimatedMinutes": 15
    },
    {
      "topicTitle": "Two Sum / complement lookup",
      "promptText": "Solve: 4Sum II (Medium) — count tuples (i,j,k,l) across four arrays with A[i]+B[j]+C[k]+D[l] == 0.",
      "answerHint": "Split into halves: map of all A+B sums with counts, then look up -(C+D) — complement lookup on pair-sums, O(n^2).",
      "promptKind": "problem",
      "url": "https://leetcode.com/problems/4sum-ii/",
      "problemDifficulty": "medium",
      "estimatedMinutes": 30
    },
    {
      "topicTitle": "Grouping by key",
      "promptText": "When do you reach for grouping-by-derived-key? Name the problem-statement signals, and the classic pitfall.",
      "answerHint": "Signals: \"group/cluster these\", items equivalent under a canonical form (sorted string, count signature, normalized shape). Pitfall: a non-canonical key (grouping anagrams by first letter) or an ambiguous string join (use a delimiter that can't appear in the data). Related: Group Shifted Strings uses a shift-invariant signature.",
      "promptKind": "concept"
    },
    {
      "topicTitle": "Grouping by key",
      "promptText": "Write the bucket-by-key loop in your language of choice: given a list of strings, group them into lists of mutual anagrams.",
      "answerHint": "key = sorted(word) (or 26-count signature stringified); map key -> list, push each word, return the map's values.",
      "promptKind": "code"
    },
    {
      "topicTitle": "Grouping by key",
      "promptText": "Solve: Group Anagrams (Medium) — group a list of strings into anagram clusters.",
      "answerHint": "Sorted string (or char-count tuple) as the bucket key; one pass.",
      "promptKind": "problem",
      "url": "https://leetcode.com/problems/group-anagrams/",
      "problemDifficulty": "medium",
      "estimatedMinutes": 30
    },
    {
      "topicTitle": "Grouping by key",
      "promptText": "Solve: Encode and Decode Strings (Medium) — design encode(list of strings) -> string and decode(string) -> list that round-trip any input.",
      "answerHint": "Length-prefix each string (e.g. \"4#word\") — delimiters alone can't work because any character may appear in the data.",
      "promptKind": "problem",
      "url": "https://neetcode.io/problems/string-encode-and-decode",
      "problemDifficulty": "medium",
      "estimatedMinutes": 30
    },
    {
      "topicTitle": "Prefix sums",
      "promptText": "When do you reach for prefix sums? Name the problem-statement signals, and the classic pitfall.",
      "answerHint": "Signals: repeated range-sum queries, \"subarray with sum X\", running totals compared across positions. Pitfall: forgetting the empty prefix (seed the map with {0: 1}) — it's what lets a subarray starting at index 0 count.",
      "promptKind": "concept"
    },
    {
      "topicTitle": "Prefix sums",
      "promptText": "Write the prefix-sum setup in your language of choice: build the prefix array for nums, then answer sum(i..j) queries in O(1).",
      "answerHint": "prefix has length n+1 with prefix[0]=0, prefix[k]=prefix[k-1]+nums[k-1]; sum(i..j) = prefix[j+1]-prefix[i].",
      "promptKind": "code"
    },
    {
      "topicTitle": "Prefix sums",
      "promptText": "Solve: Range Sum Query - Immutable (Easy) — preprocess an array to answer sumRange(i, j) calls in O(1).",
      "answerHint": "Length n+1 prefix array; subtraction answers each query.",
      "promptKind": "problem",
      "url": "https://leetcode.com/problems/range-sum-query-immutable/",
      "problemDifficulty": "easy",
      "estimatedMinutes": 15
    },
    {
      "topicTitle": "Prefix sums",
      "promptText": "Solve: Subarray Sum Equals K (Medium) — count subarrays summing to exactly k.",
      "answerHint": "Running sum + map of seen prefix-sum counts; at each step add count of (running - k). Seed {0: 1}.",
      "promptKind": "problem",
      "url": "https://leetcode.com/problems/subarray-sum-equals-k/",
      "problemDifficulty": "medium",
      "estimatedMinutes": 30
    },
    {
      "topicTitle": "Prefix sums",
      "promptText": "Solve: Product of Array Except Self (Medium) — output[i] = product of all elements except nums[i], no division, O(n).",
      "answerHint": "Prefix products left-to-right, then a right-to-left running suffix product multiplied in — prefix idea with * instead of +.",
      "promptKind": "problem",
      "url": "https://leetcode.com/problems/product-of-array-except-self/",
      "problemDifficulty": "medium",
      "estimatedMinutes": 30
    },
    {
      "topicTitle": "Sorting-based array tricks",
      "promptText": "When is \"sort it first\" the unlocking move? Name the problem-statement signals, and the classic pitfall.",
      "answerHint": "Signals: pairing/adjacency becomes meaningful once ordered, dedup, greedy picks by size/deadline, original-vs-sorted comparison. Pitfall: sorting away information you still need (original indices — copy or argsort first). Related: Sort Colors (three-way partitioning), Kth Largest (heap/quickselect), Meeting Rooms and Merge Intervals (intervals category).",
      "promptKind": "concept"
    },
    {
      "topicTitle": "Sorting-based array tricks",
      "promptText": "Solve: Merge Sorted Array (Easy) — merge nums2 into nums1 in place, where nums1 has trailing space for the result.",
      "answerHint": "Fill from the BACK (largest first) with two read pointers — writing from the front overwrites unread values.",
      "promptKind": "problem",
      "url": "https://leetcode.com/problems/merge-sorted-array/",
      "problemDifficulty": "easy",
      "estimatedMinutes": 15
    },
    {
      "topicTitle": "Sorting-based array tricks",
      "promptText": "Solve: Largest Number (Medium) — arrange non-negative integers to form the largest possible number (as a string).",
      "answerHint": "Sort with the custom comparator: a before b iff concat(a,b) > concat(b,a). Watch the all-zeros case (\"00\" -> \"0\").",
      "promptKind": "problem",
      "url": "https://leetcode.com/problems/largest-number/",
      "problemDifficulty": "medium",
      "estimatedMinutes": 30
    }
  ],
  "noteSummaries": []
}
```

- [ ] **Step 2: Validate structurally**

Run: `node scripts/validate-dsa-content.mjs`
Expected: exit 0, `1 files, 7 topics, 21 cards — 0 structural errors`.

- [ ] **Step 3: Check URLs**

Run: `node scripts/validate-dsa-content.mjs --check-urls 01`
Expected: exit 0; 12 problem urls checked, 0 failures; the NeetCode URL prints as `MANUAL-CHECK` — open it in a browser once and confirm it's the Encode/Decode problem.

---

### Tasks 3–19: author the remaining 17 category files

Each task below has the same shape — **follow the Task 2 exemplar exactly** for JSON structure, topic copying (with the `Problems:` trim), and card phrasing quality. Steps for every one of these tasks:

- [ ] **Step 1:** Write the file: copy the category concept topic + listed leaves from `apps/api/scripts-tmp/dsa-content.json` (trim `Problems:` prose from leaf descriptions), then author cards per the table — 1 concept card per leaf (always), 1 code card per leaf unless marked `skip`, problem cards exactly as tabled (title, difficulty, minutes, URL). Hints follow the templates in Global Constraints; reserved/skipped problems may appear as "related:" mentions.
- [ ] **Step 2:** Run `node scripts/validate-dsa-content.mjs` — exit 0, cumulative counts grow, 0 errors.
- [ ] **Step 3:** Run `node scripts/validate-dsa-content.mjs --check-urls NN` (this file's number) — 0 failures; manually eyeball any `MANUAL-CHECK` NeetCode URLs.

### Task 3: `content/dsa/02-two-pointers.json`

Topics: `Two Pointers` + leaves below.

| Leaf | code kernel | Problem cards |
|---|---|---|
| Opposite-direction pointers | converging two-pointer loop on a sorted array for pair-sum | Two Sum II - Input Array Is Sorted (easy, 15, https://leetcode.com/problems/two-sum-ii-input-array-is-sorted/) · Container With Most Water (medium, 30, https://leetcode.com/problems/container-with-most-water/) · 3Sum (medium, 30, https://leetcode.com/problems/3sum/) · Trapping Rain Water (hard, 45, https://leetcode.com/problems/trapping-rain-water/) |
| Fast & slow pointers (array) | slow write-pointer / fast read-pointer in-place compaction | Remove Duplicates from Sorted Array (easy, 15, https://leetcode.com/problems/remove-duplicates-from-sorted-array/) · Move Zeroes (easy, 15, https://leetcode.com/problems/move-zeroes/) |
| Three-way partitioning | Dutch-national-flag low/mid/high single pass | Sort Colors (medium, 30, https://leetcode.com/problems/sort-colors/) |

Opposite-direction is a crucial leaf (4 problems). Three-way partitioning: hint-mention quickselect/Kth Largest (carded in 09). Valid Palindrome and Remove Element are hint-mentions.

### Task 4: `content/dsa/03-sliding-window.json`

Topics: `Sliding Window` + leaves below.

| Leaf | code kernel | Problem cards |
|---|---|---|
| Fixed-size window | slide a width-k window maintaining a running aggregate (no recompute) | Maximum Average Subarray I (easy, 15, https://leetcode.com/problems/maximum-average-subarray-i/) · Permutation in String (medium, 30, https://leetcode.com/problems/permutation-in-string/) |
| Variable-size window | expand-right / shrink-left-while-invariant-violated loop | Longest Substring Without Repeating Characters (medium, 30, https://leetcode.com/problems/longest-substring-without-repeating-characters/) · Longest Repeating Character Replacement (medium, 30, https://leetcode.com/problems/longest-repeating-character-replacement/) · Fruit Into Baskets (medium, 30, https://leetcode.com/problems/fruit-into-baskets/) · Minimum Window Substring (hard, 45, https://leetcode.com/problems/minimum-window-substring/) |
| Monotonic-deque window | deque of candidate indices kept monotonic for O(1) window max | Sliding Window Maximum (hard, 45, https://leetcode.com/problems/sliding-window-maximum/) |

Variable-size is THE crucial sliding-window leaf (4 problems). Shortest Subarray with Sum at Least K: hint-mention.

### Task 5: `content/dsa/04-stack.json`

Topics: `Stack` + leaves below.

| Leaf | code kernel | Problem cards |
|---|---|---|
| Monotonic stack | next-greater-element pop-while-violating loop (pusher resolves popped answers) | Next Greater Element I (easy, 15, https://leetcode.com/problems/next-greater-element-i/) · Daily Temperatures (medium, 30, https://leetcode.com/problems/daily-temperatures/) · Largest Rectangle in Histogram (hard, 45, https://leetcode.com/problems/largest-rectangle-in-histogram/) |
| Valid parentheses / matching pairs | push-opener / pop-and-check-closer matcher | Valid Parentheses (easy, 15, https://leetcode.com/problems/valid-parentheses/) · Minimum Add to Make Parentheses Valid (medium, 30, https://leetcode.com/problems/minimum-add-to-make-parentheses-valid/) · Decode String (medium, 30, https://leetcode.com/problems/decode-string/) |
| Expression evaluation | RPN evaluation with an operand stack | Evaluate Reverse Polish Notation (medium, 30, https://leetcode.com/problems/evaluate-reverse-polish-notation/) · Basic Calculator II (medium, 30, https://leetcode.com/problems/basic-calculator-ii/) |
| Min-stack design | stack that tracks running min per entry (aux stack or encoded pairs) | Min Stack (medium, 30, https://leetcode.com/problems/min-stack/) |

Monotonic stack is crucial. Hint-mentions: Online Stock Span, Remove All Adjacent Duplicates, Basic Calculator (hard), Max Stack (premium-skip).

### Task 6: `content/dsa/05-binary-search.json`

Topics: `Binary Search` + leaves below.

| Leaf | code kernel | Problem cards |
|---|---|---|
| Classic binary search | lo/hi/mid exact-target search with correct bounds | Binary Search (easy, 15, https://leetcode.com/problems/binary-search/) · Find First and Last Position of Element in Sorted Array (medium, 30, https://leetcode.com/problems/find-first-and-last-position-of-element-in-sorted-array/) |
| Binary search on answer | search the answer space with a monotonic feasibility predicate | Koko Eating Bananas (medium, 30, https://leetcode.com/problems/koko-eating-bananas/) · Capacity To Ship Packages Within D Days (medium, 30, https://leetcode.com/problems/capacity-to-ship-packages-within-d-days/) · Split Array Largest Sum (hard, 45, https://leetcode.com/problems/split-array-largest-sum/) |
| Search in rotated arrays | decide-which-half-is-sorted step | Search in Rotated Sorted Array (medium, 30, https://leetcode.com/problems/search-in-rotated-sorted-array/) · Find Minimum in Rotated Sorted Array (medium, 30, https://leetcode.com/problems/find-minimum-in-rotated-sorted-array/) |
| Binary search on 2D matrix | flatten row/col-sorted matrix via index math | Search a 2D Matrix (medium, 30, https://leetcode.com/problems/search-a-2d-matrix/) · Search a 2D Matrix II (medium, 30, https://leetcode.com/problems/search-a-2d-matrix-ii/) |

Binary-search-on-answer is crucial. Hint-mentions: Search Insert Position, Search in Rotated Sorted Array II.

### Task 7: `content/dsa/06-linked-list.json`

Topics: `Linked List` + leaves below.

| Leaf | code kernel | Problem cards |
|---|---|---|
| Reversal | prev/curr/next pointer-rewiring loop | Reverse Linked List (easy, 15, https://leetcode.com/problems/reverse-linked-list/) · Reverse Linked List II (medium, 30, https://leetcode.com/problems/reverse-linked-list-ii/) · Reverse Nodes in k-Group (hard, 45, https://leetcode.com/problems/reverse-nodes-in-k-group/) |
| Fast & slow pointers (list) | Floyd cycle detection + midpoint find | Linked List Cycle (easy, 15, https://leetcode.com/problems/linked-list-cycle/) · Middle of the Linked List (easy, 15, https://leetcode.com/problems/middle-of-the-linked-list/) · Linked List Cycle II (medium, 30, https://leetcode.com/problems/linked-list-cycle-ii/) |
| Merge / merge-k-lists | pairwise sorted-merge taking the smaller head | Merge Two Sorted Lists (easy, 15, https://leetcode.com/problems/merge-two-sorted-lists/) · Sort List (medium, 30, https://leetcode.com/problems/sort-list/) |
| Dummy-node manipulation | remove-nth-from-end with dummy head + gap pointer | Remove Nth Node From End of List (medium, 30, https://leetcode.com/problems/remove-nth-node-from-end-of-list/) · Add Two Numbers (medium, 30, https://leetcode.com/problems/add-two-numbers/) |

Hint-mentions: Swap Nodes in Pairs, Palindrome Linked List, Merge k Sorted Lists (→09), Partition List, Remove Duplicates from Sorted List II.

### Task 8: `content/dsa/07-trees.json`

Topics: `Trees` + leaves below. (7 leaves — biggest file, ~35 cards; stay under 90KB, hints one sentence.)

| Leaf | code kernel | Problem cards |
|---|---|---|
| DFS traversals | iterative inorder with an explicit stack | Binary Tree Inorder Traversal (easy, 15, https://leetcode.com/problems/binary-tree-inorder-traversal/) · Maximum Depth of Binary Tree (easy, 15, https://leetcode.com/problems/maximum-depth-of-binary-tree/) |
| BFS / level-order traversal | queue with per-level size snapshot | Binary Tree Level Order Traversal (medium, 30, https://leetcode.com/problems/binary-tree-level-order-traversal/) · Binary Tree Right Side View (medium, 30, https://leetcode.com/problems/binary-tree-right-side-view/) |
| BST validation | range-carrying (low, high) recursion | Validate Binary Search Tree (medium, 30, https://leetcode.com/problems/validate-binary-search-tree/) · Kth Smallest Element in a BST (medium, 30, https://leetcode.com/problems/kth-smallest-element-in-a-bst/) |
| Lowest common ancestor | LCA recursion (targets in different subtrees) | Lowest Common Ancestor of a Binary Search Tree (medium, 30, https://leetcode.com/problems/lowest-common-ancestor-of-a-binary-search-tree/) · Lowest Common Ancestor of a Binary Tree (medium, 30, https://leetcode.com/problems/lowest-common-ancestor-of-a-binary-tree/) |
| Tree construction from traversals | preorder+inorder split recursion with index map | Construct Binary Tree from Preorder and Inorder Traversal (medium, 30, https://leetcode.com/problems/construct-binary-tree-from-preorder-and-inorder-traversal/) · Convert Sorted Array to Binary Search Tree (easy, 15, https://leetcode.com/problems/convert-sorted-array-to-binary-search-tree/) |
| Path-sum patterns | down-carry accumulator + combine-on-return recursion | Path Sum (easy, 15, https://leetcode.com/problems/path-sum/) · Diameter of Binary Tree (easy, 15, https://leetcode.com/problems/diameter-of-binary-tree/) · Binary Tree Maximum Path Sum (hard, 45, https://leetcode.com/problems/binary-tree-maximum-path-sum/) |
| Serialization/deserialization | preorder serialize with explicit null markers + consuming deserialize | Serialize and Deserialize Binary Tree (hard, 45, https://leetcode.com/problems/serialize-and-deserialize-binary-tree/) |

DFS traversals is the base pattern — make its concept card carry the pre/in/post distinction. Hint-mentions: Binary Tree Preorder/Postorder Traversal, Average of Levels, Insert/Delete in a BST, Path Sum II, N-ary serialization (premium-skip).

### Task 9: `content/dsa/08-tries.json`

Topics: `Tries` + leaves below.

| Leaf | code kernel | Problem cards |
|---|---|---|
| Trie construction & search | Trie node (children map + end flag) with insert/search walk | Implement Trie (Prefix Tree) (medium, 30, https://leetcode.com/problems/implement-trie-prefix-tree/) · Design Add and Search Words Data Structure (medium, 30, https://leetcode.com/problems/design-add-and-search-words-data-structure/) |
| Word Search II / prefix matching | **skip** (composite of trie + grid DFS) | Word Search II (hard, 45, https://leetcode.com/problems/word-search-ii/) |
| Autocomplete applications | **skip** (design-style leaf) | Replace Words (medium, 30, https://leetcode.com/problems/replace-words/) |

Hint-mentions: Word Break II (skipped everywhere), Design Search Autocomplete System (premium-skip).

### Task 10: `content/dsa/09-heap-priority-queue.json`

Topics: `Heap / Priority Queue` + leaves below.

| Leaf | code kernel | Problem cards |
|---|---|---|
| Kth largest/smallest | maintain a size-k min-heap so the root is the kth largest | Kth Largest Element in a Stream (easy, 15, https://leetcode.com/problems/kth-largest-element-in-a-stream/) · Kth Largest Element in an Array (medium, 30, https://leetcode.com/problems/kth-largest-element-in-an-array/) · K Closest Points to Origin (medium, 30, https://leetcode.com/problems/k-closest-points-to-origin/) |
| Top-K frequent elements | **skip** (frequency map + heap composition) | Top K Frequent Elements (medium, 30, https://leetcode.com/problems/top-k-frequent-elements/) · Sort Characters By Frequency (medium, 30, https://leetcode.com/problems/sort-characters-by-frequency/) |
| Merge-k via heap | k-way merge: heap of current heads, pop-min push-successor | Merge k Sorted Lists (hard, 45, https://leetcode.com/problems/merge-k-sorted-lists/) |
| Two-heap median-finding | balanced max-heap (lower half) + min-heap (upper half) | Find Median from Data Stream (hard, 45, https://leetcode.com/problems/find-median-from-data-stream/) |
| Task scheduling with heap | **skip** (greedy composition) | Task Scheduler (medium, 30, https://leetcode.com/problems/task-scheduler/) · Reorganize String (medium, 30, https://leetcode.com/problems/reorganize-string/) |

Hint-mentions: quickselect alternative on Kth Largest, Smallest Range Covering K Lists, Sliding Window Median.

### Task 11: `content/dsa/10-graphs.json`

Topics: `Graphs` + leaves below. **Note: this file intentionally precedes backtracking** — "Grid backtracking" (file 11) requires "DFS (connected components)" from this file.

| Leaf | code kernel | Problem cards |
|---|---|---|
| Graph representation | edge list -> adjacency map builder | Find the Town Judge (easy, 15, https://leetcode.com/problems/find-the-town-judge/) · Clone Graph (medium, 30, https://leetcode.com/problems/clone-graph/) |
| DFS (connected components) | mark-visited DFS enumerating a component (grid or adjacency) | Number of Islands (medium, 30, https://leetcode.com/problems/number-of-islands/) · Max Area of Island (medium, 30, https://leetcode.com/problems/max-area-of-island/) · Surrounded Regions (medium, 30, https://leetcode.com/problems/surrounded-regions/) |
| BFS (shortest path unweighted) | multi-source BFS frontier expansion | Rotting Oranges (medium, 30, https://leetcode.com/problems/rotting-oranges/) · 01 Matrix (medium, 30, https://leetcode.com/problems/01-matrix/) · Word Ladder (hard, 45, https://leetcode.com/problems/word-ladder/) |
| Union-Find | DSU with path compression + union by rank | Number of Connected Components in an Undirected Graph (medium, 30, https://neetcode.io/problems/count-connected-components) · Redundant Connection (medium, 30, https://leetcode.com/problems/redundant-connection/) · Accounts Merge (medium, 30, https://leetcode.com/problems/accounts-merge/) |
| Topological sort | Kahn's algorithm (in-degree queue) | Course Schedule (medium, 30, https://leetcode.com/problems/course-schedule/) · Course Schedule II (medium, 30, https://leetcode.com/problems/course-schedule-ii/) · Alien Dictionary (hard, 45, https://neetcode.io/problems/foreign-dictionary) |
| Cycle detection | three-color (white/gray/black) directed-cycle DFS | Graph Valid Tree (medium, 30, https://neetcode.io/problems/valid-tree) · Find Eventual Safe States (medium, 30, https://leetcode.com/problems/find-eventual-safe-states/) |

DFS components, BFS shortest, topological sort are all crucial (3 each). Find Eventual Safe States is a plan-chosen substitute (prose's Course Schedule is carded on Topological sort; Detect Cycle in a Directed Graph isn't on LeetCode). Hint-mentions: Number of Provinces, Shortest Path in Binary Matrix, Reconstruct Itinerary.

### Task 12: `content/dsa/11-backtracking.json`

Topics: `Backtracking` + leaves below. (Its "Grid backtracking" leaf's prereq "DFS (connected components)" resolves against file 10 — already imported/validated by order.)

| Leaf | code kernel | Problem cards |
|---|---|---|
| Subsets / combinations generation | include-or-skip recursion with push/pop undo | Subsets (medium, 30, https://leetcode.com/problems/subsets/) · Subsets II (medium, 30, https://leetcode.com/problems/subsets-ii/) · Combination Sum (medium, 30, https://leetcode.com/problems/combination-sum/) |
| Permutations generation | used-set recursion to full length | Permutations (medium, 30, https://leetcode.com/problems/permutations/) · Permutations II (medium, 30, https://leetcode.com/problems/permutations-ii/) |
| Constraint satisfaction | **skip** (the flagship problem IS the kernel) | N-Queens (hard, 60, https://leetcode.com/problems/n-queens/) |
| Grid backtracking | grid DFS with mark-before-recurse / unmark-on-backtrack | Word Search (medium, 30, https://leetcode.com/problems/word-search/) · Path with Maximum Gold (medium, 30, https://leetcode.com/problems/path-with-maximum-gold/) |
| Palindrome partitioning | **skip** (partition-and-recurse shape, covered by concept) | Palindrome Partitioning (medium, 30, https://leetcode.com/problems/palindrome-partitioning/) · Restore IP Addresses (medium, 30, https://leetcode.com/problems/restore-ip-addresses/) |

Subsets/combinations is crucial. Hint-mentions: Combinations, Letter Case Permutation, N-Queens II, Sudoku Solver.

### Task 13: `content/dsa/12-advanced-graphs.json`

Topics: `Advanced Graphs` + leaves below.

| Leaf | code kernel | Problem cards |
|---|---|---|
| Dijkstra's shortest path | min-heap relaxation loop (dist map + visited) | Network Delay Time (medium, 30, https://leetcode.com/problems/network-delay-time/) · Path with Maximum Probability (medium, 30, https://leetcode.com/problems/path-with-maximum-probability/) |
| Bellman-Ford | V-1 full-edge relaxation passes (+1 to detect negative cycles) | Cheapest Flights Within K Stops (medium, 30, https://leetcode.com/problems/cheapest-flights-within-k-stops/) |
| Floyd-Warshall | triple loop over intermediate node k | Find the City With the Smallest Number of Neighbors at a Threshold Distance (medium, 30, https://leetcode.com/problems/find-the-city-with-the-smallest-number-of-neighbors-at-a-threshold-distance/) |
| Minimum spanning tree | Kruskal: sort edges + DSU cycle check | Min Cost to Connect All Points (medium, 30, https://leetcode.com/problems/min-cost-to-connect-all-points/) |

Hint-mentions: Prim's alternative, Optimize Water Distribution (premium-skip).

### Task 14: `content/dsa/13-1d-dynamic-programming.json`

Topics: `1-D Dynamic Programming` + leaves below.

| Leaf | code kernel | Problem cards |
|---|---|---|
| Climbing stairs / Fibonacci recurrence | rolling-two-variables bottom-up tabulation | Climbing Stairs (easy, 15, https://leetcode.com/problems/climbing-stairs/) · Min Cost Climbing Stairs (easy, 15, https://leetcode.com/problems/min-cost-climbing-stairs/) |
| House robber (include/exclude) | dp[i] = max(dp[i-1], v[i] + dp[i-2]) forward loop | House Robber (medium, 30, https://leetcode.com/problems/house-robber/) · House Robber II (medium, 30, https://leetcode.com/problems/house-robber-ii/) |
| Longest increasing subsequence | O(n^2) dp[i] = 1 + max over smaller-value j (mention patience-tails O(n log n)) | Longest Increasing Subsequence (medium, 30, https://leetcode.com/problems/longest-increasing-subsequence/) · Russian Doll Envelopes (hard, 45, https://leetcode.com/problems/russian-doll-envelopes/) |
| Coin change / unbounded knapsack | dp over amounts 0..target with reusable coins | Coin Change (medium, 30, https://leetcode.com/problems/coin-change/) · Coin Change II (medium, 30, https://leetcode.com/problems/coin-change-ii/) · Perfect Squares (medium, 30, https://leetcode.com/problems/perfect-squares/) |
| Decode ways / string DP | dp[i] from dp[i-1] + dp[i-2] under validity checks | Decode Ways (medium, 30, https://leetcode.com/problems/decode-ways/) · Integer Break (medium, 30, https://leetcode.com/problems/integer-break/) |
| Word break | **skip** (same forward-tabulation shape as coin change) | Word Break (medium, 30, https://leetcode.com/problems/word-break/) |

Climbing stairs (entry) and coin change are crucial. Hint-mentions: Fibonacci Number, Delete and Earn, Number of LIS, Unique Paths (→14), Word Break II (skipped).

### Task 15: `content/dsa/14-2d-dynamic-programming.json`

Topics: `2-D Dynamic Programming` + leaves below.

| Leaf | code kernel | Problem cards |
|---|---|---|
| Grid path counting | row-by-row tabulation from top/left neighbors (rolling row) | Unique Paths (medium, 30, https://leetcode.com/problems/unique-paths/) · Unique Paths II (medium, 30, https://leetcode.com/problems/unique-paths-ii/) · Minimum Path Sum (medium, 30, https://leetcode.com/problems/minimum-path-sum/) |
| Longest common subsequence | 2D prefix-pair table fill (match: diag+1, else max of neighbors) | Longest Common Subsequence (medium, 30, https://leetcode.com/problems/longest-common-subsequence/) · Delete Operation for Two Strings (medium, 30, https://leetcode.com/problems/delete-operation-for-two-strings/) |
| Edit distance | min(insert, delete, replace) table fill | Edit Distance (hard, 45, https://leetcode.com/problems/edit-distance/) |
| 0/1 knapsack | 1-D capacity array iterated in REVERSE per item | Partition Equal Subset Sum (medium, 30, https://leetcode.com/problems/partition-equal-subset-sum/) · Target Sum (medium, 30, https://leetcode.com/problems/target-sum/) |
| Interval DP | **skip** (recurrence lives in the concept card) | Burst Balloons (hard, 45, https://leetcode.com/problems/burst-balloons/) |
| Palindromic subsequence DP | expand-around-center scan for palindromic substrings | Longest Palindromic Substring (medium, 30, https://leetcode.com/problems/longest-palindromic-substring/) · Palindromic Substrings (medium, 30, https://leetcode.com/problems/palindromic-substrings/) |

LCS is crucial (the 2-D gateway). Hint-mentions: Shortest Common Supersequence, One Edit Distance (premium-skip), Last Stone Weight II, Matrix Chain Multiplication (not on LC), Minimum Cost to Merge Stones, Longest Palindromic Subsequence.

### Task 16: `content/dsa/15-greedy.json`

Topics: `Greedy` + leaves below.

| Leaf | code kernel | Problem cards |
|---|---|---|
| Interval scheduling | sort-by-end-time + keep-if-starts-after-last-kept scan | Non-overlapping Intervals (medium, 30, https://leetcode.com/problems/non-overlapping-intervals/) |
| Jump game | farthest-reachable-frontier left-to-right scan | Jump Game (medium, 30, https://leetcode.com/problems/jump-game/) · Jump Game II (medium, 30, https://leetcode.com/problems/jump-game-ii/) |
| Gas station | **skip** (one insight, not a kernel) | Gas Station (medium, 30, https://leetcode.com/problems/gas-station/) |
| Greedy + sorting | **skip** (meta-pattern) | Assign Cookies (easy, 15, https://leetcode.com/problems/assign-cookies/) · Boats to Save People (medium, 30, https://leetcode.com/problems/boats-to-save-people/) |

Hint-mentions: Maximum Number of Events, Candy, Task Scheduler (→09).

### Task 17: `content/dsa/16-intervals.json`

Topics: `Intervals` + leaves below.

| Leaf | code kernel | Problem cards |
|---|---|---|
| Merge intervals | sort-by-start + merge-into-previous scan | Merge Intervals (medium, 30, https://leetcode.com/problems/merge-intervals/) |
| Insert interval | **skip** (three-phase walk described in concept) | Insert Interval (medium, 30, https://leetcode.com/problems/insert-interval/) |
| Non-overlapping intervals | **skip** (same kernel as greedy interval scheduling — say so in the concept card) | Minimum Number of Arrows to Burst Balloons (medium, 30, https://leetcode.com/problems/minimum-number-of-arrows-to-burst-balloons/) |
| Meeting rooms | min-heap of end times (or start/end sweep) counting simultaneous open intervals | Meeting Rooms (easy, 15, https://neetcode.io/problems/meeting-schedule) · Meeting Rooms II (medium, 30, https://neetcode.io/problems/meeting-schedule-ii) |

Hint-mentions: Employee Free Time (premium-skip), Non-overlapping Intervals (carded in 15).

### Task 18: `content/dsa/17-math-geometry.json`

Topics: `Math & Geometry` + leaves below.

| Leaf | code kernel | Problem cards |
|---|---|---|
| Modular arithmetic & number theory | fast exponentiation by squaring | Pow(x, n) (medium, 30, https://leetcode.com/problems/powx-n/) |
| Matrix rotation | transpose + reverse-rows in-place 90° rotation | Rotate Image (medium, 30, https://leetcode.com/problems/rotate-image/) · Spiral Matrix (medium, 30, https://leetcode.com/problems/spiral-matrix/) · Set Matrix Zeroes (medium, 30, https://leetcode.com/problems/set-matrix-zeroes/) |
| Prime sieve / GCD-LCM | Sieve of Eratosthenes up to N | Count Primes (medium, 30, https://leetcode.com/problems/count-primes/) |
| Geometry basics | cross-product orientation test for three points | Valid Square (medium, 30, https://leetcode.com/problems/valid-square/) |

Hint-mentions: Divide Two Integers, Nth Digit, Euclid's GCD, Max Points on a Line.

### Task 19: `content/dsa/18-bit-manipulation.json`

Topics: `Bit Manipulation` + leaves below.

| Leaf | code kernel | Problem cards |
|---|---|---|
| Basic bit ops | check/set/clear/toggle a bit; shift-based multiply/divide | Number of 1 Bits (easy, 15, https://leetcode.com/problems/number-of-1-bits/) · Reverse Bits (easy, 15, https://leetcode.com/problems/reverse-bits/) · Sum of Two Integers (medium, 30, https://leetcode.com/problems/sum-of-two-integers/) |
| Counting bits | **skip** (one-line dp, lives in concept card) | Counting Bits (easy, 15, https://leetcode.com/problems/counting-bits/) |
| XOR tricks | **skip** (identity-based, lives in concept card) | Single Number (easy, 15, https://leetcode.com/problems/single-number/) · Missing Number (easy, 15, https://leetcode.com/problems/missing-number/) · Single Number III (medium, 30, https://leetcode.com/problems/single-number-iii/) |
| Bitmask DP | iterate dp over all 2^n subset masks (submask transitions) | Partition to K Equal Sum Subsets (medium, 30, https://leetcode.com/problems/partition-to-k-equal-sum-subsets/) · Shortest Path Visiting All Nodes (hard, 45, https://leetcode.com/problems/shortest-path-visiting-all-nodes/) |

Hint-mentions: Hamming Distance. After this task, `node scripts/validate-dsa-content.mjs` totals must read **18 files, 100 topics** and roughly 300–310 cards, 0 errors; also run the FULL URL sweep once: `node scripts/validate-dsa-content.mjs --check-urls` — 0 failures (manually click the 5 NeetCode URLs).

---

### Task 20: Import script `scripts/import-dsa.mjs`

**Files:**
- Create: `scripts/import-dsa.mjs`

**Interfaces:**
- Consumes: `loadContentFiles`, `structuralErrors` from `scripts/lib/dsa-content.mjs` (Task 1).
- Produces: CLI — `node scripts/import-dsa.mjs [--dry-run] [--from NN] [--verify-only]`. Env: `TERRAIN_API` (default `http://localhost:3000`), `TERRAIN_EMAIL`, `TERRAIN_PASSWORD`, `TERRAIN_NAME` (for first-time registration).

- [ ] **Step 1: Write the script**

```js
// Preview-gated import of content/dsa into the user's real account.
//   node scripts/import-dsa.mjs [--dry-run] [--from NN] [--verify-only]
// Env: TERRAIN_API (default http://localhost:3000), TERRAIN_EMAIL,
//      TERRAIN_PASSWORD, TERRAIN_NAME (used only if registration is needed).
import { loadContentFiles, structuralErrors, norm } from './lib/dsa-content.mjs';

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
  const dsa = list.body.filter((t) => t.domain === 'DSA');
  const expectedTopics = files.flatMap((f) => f.doc.proposedTopics);
  const byTitle = new Map(dsa.map((t) => [norm(t.title), t]));
  let fail = 0;
  const bad = (msg) => (console.error(`VERIFY FAIL: ${msg}`), fail++);

  if (dsa.length !== expectedTopics.length) bad(`expected ${expectedTopics.length} DSA topics, found ${dsa.length}`);
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
  const actualEdges = dsa.reduce((n, t) => n + (t.prerequisiteIds?.length ?? 0), 0);
  if (actualEdges !== expectedEdges) bad(`prereq edges: ${actualEdges}, expected ${expectedEdges}`);

  // Full leaf sweep for autoGenerated + field integrity (paced: 100 req/min throttle).
  const leaves = expectedTopics.filter((t) => t.type === 'pattern');
  console.log(`sweeping ${leaves.length} leaves for autoGenerated/field checks (~1 min)...`);
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
      if (p.promptKind === 'problem' && (!p.url || !p.problemDifficulty || !p.estimatedMinutes))
        bad(`"${t.title}": problem card ${p.id} missing url/difficulty/estimate`);
    }
    await sleep(650);
  }
  console.log(fail === 0 ? 'VERIFY OK' : `VERIFY: ${fail} failures`);
  if (fail > 0) process.exit(1);
}

const files = await loadContentFiles();
const errs = structuralErrors(files);
if (errs.length > 0) die(`structural errors — run validate-dsa-content.mjs:\n${errs.join('\n')}`);
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

- [ ] **Step 2: Sanity-check against a running API without credentials**

Run: `node scripts/import-dsa.mjs --dry-run`
Expected: `FATAL: set TERRAIN_EMAIL and TERRAIN_PASSWORD` (exit 1) — proves arg parsing, file loading, and structural gate run first without touching the network beyond nothing.

- [ ] **Step 3: Lint/format**

Run: `yarn lint && yarn format:check` — clean. Leave uncommitted.

---

### Task 21: Execute the import against the local stack and verify

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

Ask the user for the real-account email/password (or have them export env vars themselves). Do NOT invent or hardcode credentials. Example:

```bash
export TERRAIN_EMAIL='<terrain-email>' TERRAIN_PASSWORD='<user-provided>' TERRAIN_NAME='<terrain-name>'
```

- [ ] **Step 3: Full validation + dry run**

```bash
node scripts/validate-dsa-content.mjs                 # 18 files, 100 topics, 0 errors
node scripts/import-dsa.mjs --dry-run                 # every file: preview OK, 0 unresolved
```

- [ ] **Step 4: Real import + verify**

Run: `node scripts/import-dsa.mjs`
Expected: 18 `APPLIED` lines, then the verify sweep ends `VERIFY OK`. If a mid-run failure occurs, fix the cause and re-run — applied files self-skip (`all topics already exist — SKIPPING`).

- [ ] **Step 5: Eyeball the roadmap UI**

`yarn workspace @terrain/web dev &`, then per `docs/ops/local-dev.md` drive Brave headless via CDP (`scripts/smoke.mjs` pattern) — log in as the real account, load the roadmap/graph screen, confirm the DSA tree renders 100 nodes with prereq edges and a leaf's detail panel shows its authored cards (concept/code/problem kinds, no starter card). Screenshot for the user.

- [ ] **Step 6: Ledger + tree hygiene**

Append to `.superpowers/sdd/progress.md`: date, "DSA curriculum imported: 18 files, 100 topics, N cards into <email>'s account via scripts/import-dsa.mjs; validation + verify green; content maintained in content/dsa/". Run `yarn lint && yarn format:check` one final time. Leave everything uncommitted and remind the user the working tree holds: `content/dsa/` (18 files), `scripts/lib/dsa-content.mjs`, `scripts/validate-dsa-content.mjs`, `scripts/import-dsa.mjs`, the spec, this plan, and the ledger update.
