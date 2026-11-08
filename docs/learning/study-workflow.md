# A sustainable learning workflow

Keep the complete curriculum as a long-term map. Study one primary topic deeply
and keep one project milestone active. Chapter order expresses your preferred
journey; actual concept prerequisites determine readiness. A difficult lesson can
take several sessions without requiring a new plan or a faster deadline.

## One session

1. Resume the saved next step and choose one bounded objective. Use recorded work
   first. If a relevant prerequisite is uncertain, make one to three open attempts
   in total before hints; do not restart an exam of all prerequisites. One mistake
   is a reason to investigate, not a diagnosis or permission to skip the roadmap.
2. Study the relevant source, checking its version when the mechanism changes
   quickly. Explain the idea in your own words and draw or trace an example.
3. Build, calculate or diagnose something that can be wrong. Run a meaningful
   check, inspect the failure, and explain what corrected your model.
4. Update the editable topic note in **Terrain**: what you understand, what is
   still fragile, the artifact and result, and one concrete next step. Reconcile
   the existing explanation rather than appending every AI response.

These steps can span several sessions. Reading, a derivation or a partial lab is
valid progress. Stop at the agreed time and save the remaining objective. A
supported correction belongs beside the original attempt; it does not replace
the initial evidence or create another recall grade. Feedback should describe the
specific discrepancy, distinguish uncertainty from a confirmed error, and give
you a chance to repair your own reasoning.

Terrain is the canonical, editable note home across devices. External Obsidian,
OneNote or HTTPS links are optional references. Executable artifacts and tests
belong in the practice or product repository; link them from the topic note.
Keep the topic summary short enough to resume from, and preserve the richer
explanation in the note. Templates: [topic note](topic-note-template.md) and
[architecture decision](architecture-decision-template.md).

Updated learning-session exports ask chat to finish with copyable Markdown notes
for each topic substantially covered, followed by the normal Terrain import block.
Import the session block to save its compact handoff and recorded evidence. Copy
the separate note into **Personal notes → Edit notes**, reconcile it with any
existing explanation, and click **Save notes**. Importing the chat response does
not save the longer note. To have chat consolidate an existing note, paste that
note into the conversation; personal notes are not automatically exported.
The draft should preserve partial understanding and open questions, and distinguish
the tutor's explanation from work you demonstrated yourself.

For a two-hour day, try 15 minutes of bounded recall, 90 minutes on the main
objective and 15 minutes to consolidate. Do not clear the entire backlog before
learning. A third available hour is optional capacity. Slow new card activation
if reviews repeatedly exceed the time you want to spend.

## Two tracks (revision 2026-11-08)

The complete roadmap stays; no topic is skipped or shortened. What changes is
that executable topics run in parallel with theory instead of after it, and
each topic's artifact matches its nature. Every week ends with at least one new
contract or script in the practice repository that has a test, a boundary case
and a revert path. See the
[tutor review](../reviews/2026-11-08-web3-tutor-review.md) for the reasoning.

- **Build track (primary).** Phase 2 Solidity and Phase 3 Foundry leaves in
  authored order, starting with Foundry project anatomy and Value types. Each
  leaf is one bounded lab: predict → run → explain, failing test first, one
  boundary case, one revert path, one sentence of threat model, pinned
  compiler/EVM versions, one production implementation read. Socratic
  throughout; as many sessions as the mechanism needs.
- **Explainer track.** The remaining Phase 1 consensus, L2, account-abstraction
  and protocol-state leaves, marked `Form: explainer` in their Build line:
  source, Socratic teach-back of the mechanism and its assumptions, a
  derivation where there is one, one failure case or tradeoff, one real-chain
  observation, cards as needed, a note. Full depth; only the repository
  artifact, checkpoint and skill check are not required.
- **Product track.** W1 read-only wallet; rebuild the raw-RPC client as its RPC
  module rather than as a separate recovery lab. Mini-EVM, RLP and HD rebuilds
  stay in the Practice Revisit queue; take one when a current mechanism needs it.

## A week at 2–3 hours a day (15–20 hours)

| Activity | Hours |
|---|---:|
| Three build sessions (Solidity / Foundry leaf with tests) | 6 |
| One product session | 2 |
| Explainer-form sessions (Phase 1 theory, full depth) | 3 |
| Daily bounded recall | 1.5 |
| One delayed skill check or deliberate variant | 0.5 |
| Notes, drawings, checkpoints and import admin | 2 |
| Reading production code or one audit report | 1 |
| Buffer, DSA or recovery | 2 |

Adjust these allocations to actual time and difficulty. If sessions are being
consumed by admin rather than by mechanisms, cut admin (batch imports, shorter
checkpoints), never depth. You do not need to touch every activity every day.

## Evidence and continuation

- Distinguish **studied**, **recalled**, **applied**, and **independently checked**.
  A saved note, familiar card or passing scaffold does not establish transfer.
- Record help honestly: independent, hints, pairing or generated. State allowed
  tools before an independent check. Documentation may be allowed when that is
  part of the skill; AI-produced core code changes the independence claim.
- Return after a delay with a changed case. About a week is a starting convention,
  not a fixed prescription. Preserve the first attempt; do not rehearse the exact
  assessment immediately beforehand.
- For DSA, mix unlabeled problems from studied families and change a condition
  that can invalidate the familiar pattern. Explain the model, cost and
  correctness argument before naming a template.
- For DeFi, derive units, balance sheets, rounding, invariants and who loses under
  stress before treating a working integration as completion.

Once a week, inspect what you can do without help, which misconception returned,
whether the notes made resuming easier, and which workload should shrink. Keep
one useful next step. A review-habit streak and topic counts support this check;
they do not replace it.

Use the existing one-hour weekly check/review allocation deliberately:

1. Spend 20–30 minutes on one due **Skill check** with a changed case and the
   agreed tools. Save the first attempt and artifact reference before feedback.
2. Spend 10–15 minutes reviewing actual help, failures, uncertain evidence and
   whether the next step was easy to resume on another computer. A suspected
   misconception stays tentative until the evidence supports it.
3. Choose one bounded follow-up. Use the remaining time for feedback or planning;
   reduce new work when pending checks exceed the available budget. Do not create
   a new check after every small lesson or append tests to the daily recall slice.

The topic and project-milestone **Skill checks** forms already accept a tutor's
separate `terrain-practice` suggestion. Filling a draft does not schedule it or
record success: review the target, task, criteria, allowed tools and dates, then
save. After feedback, record the actual result and reviewer yourself. For a small
evaluation of this workflow, use the [personal pilot guide](personal-learning-pilot.md).

Begin the product path with wallet → indexer → escrow, then follow the DeFi branch
with distribution concepts where needed. Reuse infrastructure and keep the other
projects available for later. Re-estimate after two milestones. Record a design
choice, its cost and the changed requirement that would invalidate it.

For the current practice repository's narrowly demonstrated scope and the
prepared hygiene patch, see [practice checks](practice-hygiene.md).

For protocol sources, record the version and target network/fork when relevant.
The Yellow Paper remains useful for its formal model, but its maintained PDF
describes **Shanghai** and omits **Cancun and later upgrades**. Match current
execution rules to the appropriate fork in the
[Ethereum Execution Layer Specifications](https://github.com/ethereum/execution-specs),
whose default branch may describe a future fork. This scope was checked on
2026-10-14 against the [Yellow Paper repository notice](https://github.com/ethereum/yellowpaper#repository-currently-outdated)
and the [PDF's version heading](https://ethereum.github.io/yellowpaper/paper.pdf).

## Twelve-week checkpoints

These are pace checks, not deadlines. Continue a difficult topic when it needs
more time instead of adding simultaneous work. All evidence is observable in
the practice repository.

- **Week 1:** upgrade the practice repository toolchain on every computer and
  CI together; write the first Phase 2 contract with a Foundry test; start one
  explainer-form Phase 1 leaf. Fill in the Settings profile fields.
- **Week 4:** Phase 2 "Types & data locations" and "Functions" chapters done
  with about ten tested contracts; four explainer-form leaves done; one delayed
  skill check attempted on a changed case.
- **Week 8:** ERC-20 written from scratch with a fuzz test; first reentrancy
  exploit and fix; Phase 1 explainer-form leaves finished; W1 wallet reads a balance
  with distinct loading, empty and failed states.
- **Week 12:** Phase 2 complete; first three Ethernaut levels solved in Foundry
  with written explanations; re-estimate the pace and decide how much time
  Phase 3 depth versus Phase 4 standards should take.
