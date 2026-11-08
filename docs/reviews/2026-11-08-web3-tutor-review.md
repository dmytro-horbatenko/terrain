# Terrain as a Web3 tutor — review and re-plan

8 November 2026. Source: local Terrain checkout at `2c26b7f`, the Web3 course
content, `web3-practice` at `334a2bd`, prior reviews (2026-09-25, 2026-10-12/14,
2026-11-01), and outside research cited below. The live database and the
deployed UI were not reachable from this session, so learner-state numbers are
taken from the 2026-11-01 analysis (18 learned leaves) and the local repos.
Nothing here changes learner progress; content and prompt edits are listed at
the end and remain uncommitted.

Learner profile, stated the same day: four years of programming including two
in Web3, employed, 2–3 study hours almost daily. Goal: comprehensive,
depth-first understanding of Web3, prioritising Ethereum, Solidity and DeFi.
Socratic style; readable over optimised code, TypeScript; OneNote drawings plus
Obsidian Markdown. Preserve the complete step-by-step roadmap; never skip topics
automatically or optimise for job readiness; develop mechanisms, assumptions,
derivations, edge cases, tradeoffs and independent application across as many
sessions as needed; keep deep study and product practice complementary.

## 1. Verdict

The learning machinery is better than anything commercial: honest evidence
(first attempt preserved, help recorded, self-graded recall), a concept-gated
graph instead of phase gates, exact source scopes, delayed changed-case Skill
checks, versioned practice checkpoints, and a product catalogue with failure
drills. Keep all of it.

The problem is not rigor. It is **allocation**. After four months the roadmap
shows 18 of 365 leaves studied and **no Solidity written** (`contracts/phase02`
is empty; the only Foundry test asserts `1 + 1 == 2`). The system's default
"Next up" walks authored order, and every one of the 17 remaining Phase 1
leaves is an explainer-only topic (consensus, L2s, account abstraction,
protocol history). Meanwhile the graph already permits "Foundry project
anatomy" and "Value types & their defaults". A tutor would have had you
writing contracts in week two.

| Pace | Leaves / month | Time to finish 347 remaining leaves |
|---|---:|---:|
| Observed (Jul → Nov 2026) | ~4.5 | ~6.5 years |
| Design assumption (≈3 h per leaf at 15 h/week) | ~20 | ~1.5 years |
| Two-track plan below | ~12 build + ~8 explainer | ~1.5 years at 15–20 h/week, Solidity labs from week 1 |

The goal is comprehensive, depth-first understanding with the whole roadmap
intact and no optimisation for job readiness. Depth in the EVM, Solidity and
DeFi is built by predicting, running, breaking and explaining mechanisms, so
the question is how the available 2–3 daily hours are spent: on mechanisms and
builds, or on theory-first sequencing and admin. The rest of this document
re-aims the existing machinery at that without removing or shortening a topic.

## 2. What the current flow does well

- **AI cannot write learner state.** Everything enters through a previewed
  import; grades are the learner's verdict; checkpoints are learner-confirmed.
  This matches the 2026 evidence: delegating code to AI lowers comprehension,
  asking AI conceptual questions does not ([Anthropic RCT, Jan 2026](https://www.anthropic.com/research/AI-assistance-coding-skills);
  [TUM CS1 three-arm RCT](https://www.sciencedirect.com/science/article/pii/S2666920X25001778)).
- **Concept prerequisites, not chapter gates** (`roadmap-policy.ts`). The graph
  is already permissive enough for a build-first path.
- **Source plans** name a section and a verification date per source. Useful
  and rare.
- **Skill checks** implement delayed, changed-case transfer with an allowed-tools
  policy. This is the only honest "can I do it" signal in the system.
- **Practice checkpoints** store path, exact version, command, observed result,
  help and next action, separate from mastery.

## 3. What gets in the way

1. **Default sequencing.** `LearningContextService.select` picks the first
   planned learnable leaf in curriculum order. With the Web3 root authored
   depth-first, that is always Phase 1 until Phase 1 is finished. The learner
   can pick an alternative, but the dashboard never suggests one.
2. **Every leaf gets the same ritual.** Source → reconstruction → teach-back →
   application → Markdown notes → import → checkpoint → optional Skill check.
   That is right for "delegatecall & storage context"; for "EIP-7251 &
   validator consolidation" the honest artifact is a derivation and an
   observation, not a repository checkpoint. The system does not distinguish
   the two forms.
3. **Admin tail per session.** Copy, paste, study, request the output block,
   paste back, preview, save, copy notes, paste notes, save notes, open
   Practice, fill a 10-field form. Roughly 10 minutes per session, and a strict
   JSON parse failure loses the record. The 2026-11-01 analysis already named
   this; it has not shrunk.
4. **Prompt shape.** The learning export is ~400 lines of rules before any
   teaching happens, and most of it says what not to do. It never states your
   goal, and it has no Web3-specific lesson shape (predict → run → explain,
   threat model, gas measurement, reading production code). A tutor needs the
   positive picture as much as the guardrails.
5. **Recovery detour.** The 2026-11-01 pilot queues raw RPC, storage lab, RPC
   variant, then mini-EVM or W1 across 6–8 sessions before Solidity. RLP, HD
   derivation and the mini-EVM are Phase 8 depth. Rebuilding them now spends
   a month on topics already marked active.
6. **Cards and reviews** go through chat too (72% of the 526 authored cards are
   concept cards). Fine pedagogically, heavy operationally.
7. **Practice repo drift.** `web3-practice` pins Solidity 0.8.35 and Foundry
   1.7.1; current releases are 0.8.38 (22 Oct 2026) and 1.9.0 (2 Nov 2026).
   Not urgent, but upgrade before the first real contract so the baseline is
   the one you will live with.

## 4. Research that informs the plan

| Finding | Source | Consequence here |
|---|---|---|
| AI-assisted learners scored 50% vs 67% on a comprehension test; those who asked conceptual questions kept learning, those who delegated generation did not | [Anthropic, 2026](https://www.anthropic.com/research/AI-assistance-coding-skills), [arXiv 2601.20245](https://arxiv.org/html/2601.20245v1) | Keep "learner writes the core mechanism". Make the tutor an explainer, reviewer and adversary. |
| Scaffolded hints and unrestricted ChatGPT both raised task scores; neither improved pre/post knowledge | [TUM CS1 RCT](https://www.sciencedirect.com/science/article/pii/S2666920X25001778) | Performance in the session is not evidence. Keep Skill checks as the only "can do" signal. |
| Course-integrated AI tutor access lowered final grades by 0.37 SD in at least one course | [EdWorkingPaper 26-1598](https://edworkingpapers.com/ai26-1598) | Structure matters more than access. Keep the conduct scripts, but make them teach a shape, not only forbid. |
| Predict–Run–Investigate–Modify–Make; tracing before writing; faded worked examples beat code writing for teaching patterns | [Sentance et al., PRIMM](https://primmportal.com/wp-content/uploads/2020/10/teaching-computer-programming-with-primm-a-sociocultural-perspective.pdf), [Raspberry Pi pedagogy review](https://www.raspberrypi.org/app/uploads/2021/11/Teaching-programming-in-schools-pedagogy-review-Raspberry-Pi-Foundation.pdf), [Weinman et al., CHI 2021](https://acelab.berkeley.edu/wp-content/papercite-data/pdf/parsons-chi2021.pdf) | Default lesson shape for build topics: predict → run → explain. For an unfamiliar mechanism: one worked example with named subgoals, then a faded version, then your own variant. |
| Industry ordering: Updraft (Foundry) → Speedrun/projects → RareSkills or Secureum depth; Foundry-first; seniors are distinguished by EVM internals, Yul, fuzz/invariant tests, formal verification, business-logic bugs and shipped, audited code | [Cyfrin career tracks](https://updraft.cyfrin.io/career-tracks), [gm.careers 2026](https://gm.careers/blog/web3-certifications-courses-2026), [web3.career auditor guide](https://web3.career/learn-web3/smart-contract-security-auditor-2026), [nadcab roadmap](https://www.nadcab.com/blog/smart-contract-auditor-roadmap) | The roadmap already contains all of this. The gap is reaching it. Volume of real contracts, breaks and fixes is the lever. |
| Fusaka live since 3 Dec 2025; Glamsterdam on Sepolia since 6 Oct 2026, mainnet date not set; Solidity 0.8.38; Foundry 1.9.0 | [CoinGecko](https://www.coingecko.com/learn/what-is-ethereum-fusaka-upgrade), [Everstake](https://everstake.com/resources/blog/ethereum-glamsterdam-upgrade-explained), [Solidity releases](https://www.soliditylang.org/blog/category/releases/), [Foundry releases](https://github.com/foundry-rs/foundry/releases) | Curriculum currency is acceptable. Pin new versions deliberately and note them in checkpoints. |

None of these studies measures months of self-directed smart-contract study
with an AI tutor. They support principles; the plan below is a hypothesis you
check with your own pace and Skill-check results.

## 5. The plan: two tracks, one artifact per week

**Principle.** The complete roadmap stays and nothing is skipped or shortened.
Executable topics run in parallel with theory instead of after it, and each
topic's artifact matches its nature. Every week ends with at least one new
contract or script in `web3-practice` that has a test, a boundary case and a
revert path. Theory runs in parallel in explainer form at full depth. Recovery
of old labs is folded into the product track, not scheduled on its own.

### Track A — Build (primary, ~60% of study time)

Solidity and Foundry leaves in authored order, starting now with
"Foundry project anatomy" then "Value types & their defaults". Each leaf is
one bounded lab: predict the behaviour, gas or storage effect; run it with
pinned compiler and EVM versions; explain the discrepancy; write the failing
test first; add one boundary case and one revert path; write one sentence of
threat model (who may call this, what breaks if they lie). Read one production
implementation of the mechanism (OpenZeppelin, Uniswap, Solady) before a
second explanation. Socratic throughout: the tutor asks for your prediction or
derivation before giving its own. These leaves are small; two or three a week
is realistic, and a hard one may take several sessions.

Checkpoints to judge pace, all observable in the repo:

| By | Evidence |
|---|---|
| Week 4 | Phase 2 "Types & data locations" and "Functions" chapters done; ~10 contracts with Foundry tests |
| Week 8 | ERC-20 written from scratch with a fuzz test; first reentrancy exploit and fix; one Skill check passed on a changed case |
| Week 12 | Phase 2 complete; first three Ethernaut levels solved in Foundry with written explanations; W1 wallet shows a balance with correct error states |

If sessions are being consumed by admin rather than by mechanisms, cut admin
(batch imports, shorter checkpoints), never depth.

### Track B — Fundamentals in explainer form (~20%)

The 17 remaining Phase 1 leaves (PoS, finality, rollups, blobs, 4337, 7702,
Pectra/Fusaka, roadmap), studied at full depth: read the source scope, Socratic
teach-back of the mechanism and its assumptions, a derivation where there is
one (the stake cost of reverting finality, the blob fee from excess blob gas,
a bundler's margin from a real receipt), one failure case or trade-off, one
10-minute real-chain observation (a `cast` query, a beacon explorer lookup,
decoding a real `handleOps` receipt), cards as needed, a note. What is dropped
is the repository artifact, the checkpoint form and the Skill check, not the
depth or the number of sessions. The curriculum edits below mark these leaves
`Form: explainer` and give each a concrete observation.

### Track C — Product (~15%)

W1 read-only account workspace. Rebuild the raw-RPC client **as W1's RPC
module**, not as a separate recovery lab: the module needs the same
result-versus-error, bigint and timeout boundaries. Mini-EVM, RLP and
HD-derivation rebuilds stay in the Practice Revisit queue; take one when a
current mechanism needs it rather than as a prerequisite queue. Those topics
remain active, and the knowledge is not lost, only the files.

### Recall and transfer (~5%)

Keep the 15-minute review slice. Schedule one Skill check per fortnight on a
build mechanism with a changed constraint; do not create one per lesson.

### A week at 2–3 hours a day (15–20 hours)

| Slot | Hours |
|---|---:|
| Three build sessions (Track A) | 6 |
| One product session (Track C) | 2 |
| Explainer-form sessions (Track B) | 3 |
| Daily review slice | 1.5 |
| One Skill check or deliberate variant | 0.5 |
| Notes, drawings, checkpoints, import admin | 2 |
| Reading production code or an audit report | 1 |
| Buffer / recovery | 2 |

## 6. How to use the AI tutor well

- Before an attempt: ask for the condition, the acceptance checks and the
  environment. Not the code.
- During: ask conceptual questions ("why does `calldata` avoid the copy?"),
  request a counterexample, request a faded example for an unfamiliar
  mechanism. If you ask for code, record it as `generated` or `pairing` and
  plan a changed-case check later.
- After: have it review your reasoning and tests, propose the attack you
  missed, and name the invariant your tests do not pin down.
- Never let it fill the `learning-os` block with work you did not do; the
  import previews it, read the preview.

## 7. Changes made in this review (uncommitted)

1. `apps/api/src/sessions/session-conduct.ts` — made the tutor **Socratic by
   default** (ask for the learner's prediction or derivation first, calibrated
   to recorded experience), added an **Artifact form** rule (build vs
   explainer, inferred from the Build line when unmarked; explainer form keeps
   full depth and uncapped sessions, drops only the repository artifact) and a
   **Web3 engineering shape** (predict → run → explain, failing test first,
   boundary and revert case, threat-model sentence, read a production
   implementation, record compiler/EVM versions). Existing guardrails and
   their tests are preserved.
2. `packages/types/src/practice.ts` — the implementation-session brief now
   states the same engineering shape and version pinning.
3. `content/web3/00-root.json` — root and Phase 1 chapter guidance now say:
   start Solidity/Foundry in parallel now; the consensus, L2, AA and
   protocol-state leaves take explainer form at full depth; nothing is skipped.
4. `content/web3/01a-core-ethereum.json` — "Reading storage slots" and
   "World state & Merkle Patricia tries" become executable labs; four learned
   explainer topics (data locations, opcodes, fee market, nonce) gain
   predict → run → explain rebuild variants for the Practice "Revisit" queue.
5. `content/web3/01b-consensus-scaling-aa.json` — all 15 leaves marked
   `Form: explainer` with a concrete 10-minute observation each.
6. `docs/learning/study-workflow.md` — weekly plan rewritten as the two-track
   plan above.

Rollout: these are content and prompt changes with no migration. Deploy as in
`docs/ops/game-update-quickstart.md`, then in **Courses → Review curriculum
updates** for Web3, inspect preserved custom fields and apply. Learned topics
keep their status; only the authored Build text changes.

## 8. Changes that need your decision (code)

| # | Change | Why | Size |
|---|---|---|---|
| 1 | **Two "Next up" picks** on the dashboard: authored-order next (theory) and next build leaf (first learnable leaf with a code artifact in Phases 2+) | Makes Track A the default rather than something you must search for | Small: `nextUp` returns a second candidate; TodayCard shows two Start buttons |
| 2 | **Pace card**: build leaves and references per week over the last four weeks | Turns "am I actually building?" into a glance | Small |
| 3 | **Quick grade** for concept cards in-app (GradePicker exists) | Removes a chat round-trip for simple recall; keeps FSRS honest | Medium |
| 4 | **MCP write tool** `save_practice_checkpoint` (status forced to `active`, learner confirms reference in UI) | Removes the paste step for checkpoints; the tutor saves the draft directly | Medium; needs the OAuth scope review |
| 5 | **Explainer-form export**: a shorter learning export (no checkpoint nudge) when the Build line says `Form: explainer` | Cuts admin for theory sessions without touching depth | Small once #1 exists |

I recommend 1 and 2 first; they change behaviour without new storage.

## 9. Settings to fill in now (zero code)

The export's "WHO I AM" block is built from Settings. Text in the learner's
own words, lightly arranged into the four fields:

- **Role:** Software engineer, four years of programming including two in
  Web3, employed; 2–3 study hours almost daily. Goal: comprehensive, deep
  understanding of Web3/blockchain, prioritising Ethereum, Solidity and DeFi.
  Preserve the complete step-by-step roadmap; do not skip topics
  automatically or optimise for job readiness.
- **Learning style:** Socratic, depth-first, tabulation over memoization. Use
  my experience to calibrate explanations and challenge depth. Develop
  mechanisms, assumptions, derivations, edge cases, tradeoffs and independent
  application across as many sessions as needed. Keep deep study and product
  practice complementary. Predict → run → explain for anything executable.
- **Code style:** Readable over optimized. TypeScript for scripts and tooling;
  Solidity with Foundry for contracts, pinned compiler and EVM versions.
- **Note system:** OneNote (iPad drawings) + Obsidian (Markdown). Terrain
  keeps the compact session summary and links to them.

## 10. Practice repo housekeeping

- Upgrade to Solidity 0.8.38 and Foundry 1.9.0 on both Macs and CI together,
  then re-run `yarn check`. Record the new baseline in `README.md`.
- Add `.idea/` to `.gitignore`.
- Create `contracts/phase02/` and `test/phase02/` when the first Track A lab
  starts; do not pre-create folders.
