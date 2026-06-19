# SDD tooling (workflow-driven subagent development)

Reusable Workflow scripts + templates for building features the way Terrain's Phase 1a / 1b / Phase-2-import
slices were built: **brainstorm → spec → plan → task-by-task implementation, with an adversarial review at
every layer.** Drop-in for Claude Code's `Workflow` tool.

## The loop

```
brainstorm  ─►  write SPEC            ─►  adversarial-review.js (lenses: completeness, consistency,
(superpowers)   (docs/.../specs/…)         feasibility-vs-code, master-spec alignment) ─► fold fixes
                      │
                      ▼
                write PLAN            ─►  adversarial-review.js (lenses: code-correctness — will the
(superpowers:           (docs/.../plans/…)   plan's code build & its tests pass?; type/spec consistency) ─► fold fixes
 writing-plans)        │
                      ▼
   for each task (SEQUENTIAL when they share files / DB / migrations):
        sdd-task.js  ─►  implement (TDD) ─► review (spec+quality) ─► fix loop ─► compact verdict
                      │
                      ▼ CONTROLLER CHECKPOINT (you, in the main loop):
                      run the task's tests + build YOURSELF (ground truth, anti-fabrication),
                      append one line to the durable ledger, then edit sdd-task.js for the next task.
                      │
                      ▼ after all tasks:
        adversarial-review.js (whole branch: correctness, integration, spec-coverage, data/security)
                      │
                      ▼ triage: fix Critical/Important (one remediation slice via sdd-task.js),
                        surface Minors / plan-contradictions to the human.
```

## Files

| File | What it is | Edit before each run |
|---|---|---|
| `sdd-task.js` | Runs ONE plan task: implement → review → fix loop. Returns a compact verdict. | the `SCRATCH`/`REPO_DIR`/`TASK` config block |
| `adversarial-review.js` | Multi-lens find → refute-verify → synthesize. Works on a spec, a plan, or implemented code. | the `SUBJECT`/`PRIMARY`/`CODE`/`LENSES` config block |
| `constraints.template.md` | The project-wide "constraints handoff" both the implementer and reviewer read. | copy to scratchpad, fill in |

## How to drive it (a task)

1. Extract the task into a **brief file** (`task-N-brief.md`): its requirements + the **exact code** to write,
   the test command, and a report contract. One task per brief — never make an implementer read the whole plan
   (a briefless implementer reads the plan and over-builds).
2. Point `sdd-task.js`'s `TASK.briefPath` / `constraintsPath` / `changedFiles` / `testCommand` at it; pick models
   (sonnet implementer; opus reviewer for logic-heavy, sonnet for mechanical).
3. `Workflow({ scriptPath: "docs/superpowers/tooling/sdd-task.js" })`. It runs in the background; you're notified
   on completion.
4. **Checkpoint yourself**: run the task's tests + build, confirm green with your own eyes, record it, move on.

## Hard-won practices (why the scripts are shaped this way)

- **Literal config, not Workflow `args`.** Passing `args` alongside `scriptPath` arrived empty in practice; the
  briefless implementer then read the whole plan and built ~everything unreviewed. Config is a literal block.
- **The controller verifies every task.** The per-task reviewer judges from files + the implementer's report
  (it does not re-run tests). YOU re-run the tests + build between tasks — that's the anti-fabrication gate.
- **Durable ledger.** Track progress in a file (e.g. `.superpowers/sdd/progress.md`), not just in chat — it
  survives compaction and is the recovery map (the commits/files it names exist even if context forgets).
- **Sequential tasks for shared state.** Tasks that touch the same file, the DB, or migrations must run one at a
  time. Only fan out truly independent work.
- **`skipImplement: true`** turns `sdd-task.js` into a review-only gate over code already on disk (recovery, or
  gating pre-existing work) — set `existingStateNote` to the verified on-disk state.
- **Refute-biased verification** kills plausible-but-wrong findings: every finder claim faces an independent
  skeptic that defaults to REFUTE. Triage only what survives.
- **Stopping a dev server:** the launcher's wrapper name often isn't the process that holds the port (e.g.
  `nest start` runs `node …/dist/src/main`). A `pkill -f "<wrapper>"` can miss it, leaving a zombie that serves
  stale compiled code and makes a fresh start fail `EADDRINUSE` silently. Kill via `lsof -ti:<port>`.

## Provenance

These were authored while building Terrain. Briefs, E2E drivers, and per-phase review scripts were generated per
slice in the session scratchpad (ephemeral); this directory holds the **reusable** machinery + templates.
See `docs/superpowers/specs/` and `docs/superpowers/plans/` for the worked examples, and
`.superpowers/sdd/progress.md` for the build ledger.
