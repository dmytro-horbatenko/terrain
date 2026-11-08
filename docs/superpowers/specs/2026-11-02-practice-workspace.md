# Practice workspace

Terrain keeps a learner-owned implementation trail alongside the existing roadmap, source requirements, FSRS and independent Skill checks.

## User flow

- Dashboard prioritizes continuing implementation or revisiting a studied lesson without a structured reference. Review and new study remain reachable.
- Practice shows every non-archived leaf in enabled courses, in authored order. Views: unfinished work, studied lessons to revisit, references, eligible next lessons, and full coverage including blocked lessons.
- Recovery is an implementation attempt with feedback, not a reset of previous study. Existing notes and application events remain historical evidence. No missing-code inference changes mastery.
- First exposure uses the existing guided study and required sources. The learner can keep partial implementation checkpoints during that work. The normal learning import continues to own study activation.
- A checkpoint stores the bounded task, acceptance checks, repository path, exact code version, backup URL, command, observed result, explanation, help used and next action.
- A reference requires the artifact/version, checks, result, explanation, assistance declaration and explicit confirmation. It remains learner-recorded; generated code is not independent mastery.
- Rebuilding creates new immutable checkpoints. The prior reference remains available in the library and history.
- Changed-case delayed assessment reuses Skill checks. Existing pending checks are preserved; practice exports do not include pending check prompts/answers.
- AI output is previewed as an active draft. It cannot mark a reference accepted, update a topic, submit FSRS grades or record an application event automatically.

## Storage and integration

PracticeProgress is unique per owner/topic and has a revision. PracticeCheckpoint is append-only, with an idempotency ID and optimistic revision check, serialized by an owner/topic advisory lock. All reads/writes are owner-scoped. No migration backfills invented practice evidence.

The latest checkpoint is included in the read-only learning context (and therefore MCP) and normal study exports. Practice exports include that learning context and authored scope. Browser navigation warns about unsaved drafts; downloads are available before conflict resolution. Errors retain the form.

Source files live in the practice repository. Terrain stores references, not file backups. A backup URL is optional and its absence is visible. Neither stored paths nor URLs are checked against the filesystem or executed.

## Rollout

Apply the additive Prisma migration `20261102000000_practice_checkpoints` before starting the new API. Generate the Prisma client, build the types package, API and web. Deploy the API and web together. No production data was changed during development. Old API/web versions can ignore the two new tables; rollback does not require dropping them.

## Recovery approach for this learner

Revisit the 18 studied foundation lessons through their existing authored Build scopes; the queue is derived from live topic state, not a hard-coded count. Start with one bounded raw-RPC experiment if it gives the best bridge to current storage work, then cover the remaining foundation lessons in roadmap order. Preserve working hashing, Merkle and signing code as starting evidence and add missing boundary/failure cases. Reconstruct RLP, HD derivation and mini-EVM only as far as their respective lesson scopes require; do not reimplement all of Ethereum in one task. Continue Reading storage slots and World state/MPT via normal guided study after the relevant prerequisites. The full authored roadmap stays visible.

A practical session ends with either a saved partial checkpoint or a versioned reference, plus a precise next action. A later Skill check uses a changed constraint without showing the previous solution first. There is no universal fixed percentage of coding time or automatic mastery from tests.

## Verification / environment (2026-11-02)

The API and web compile locally; the Vite production bundle is built in a temporary output directory. Standard Nest build cleanup is blocked by this session's permissions on the old dist directory; TypeScript compilation uses a separate output directory instead. API unit suites pass except the two existing OAuth/MCP HTTP suites, which cannot listen on local ports in this environment. The web/type suites and lint pass. Migration deployment and production UI smoke remain required.

Production uses the existing Linux server through `ssh game`, fish, and locally built Linux images; never build on the small server. See `docs/ops/deploy.md`. This session cannot resolve the SSH alias and cannot access the OrbStack Docker socket even after escalation. No Linux images have been built or transferred and no production database migration has been applied. Keep the new migration before new API startup; retain previous images for rollback. Source changes remain uncommitted per AGENTS.md.
