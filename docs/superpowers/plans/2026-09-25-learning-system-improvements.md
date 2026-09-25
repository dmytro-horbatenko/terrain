# Learning system improvements implementation plan

> Execution: inline using the planning, systematic-debugging, test-driven-development and verification skills. Keep changes uncommitted as required by AGENTS.md.

**Goal:** Implement the recommendations approved from the September learning-system review while preserving all recorded progress and the comprehensive curriculum.

**Architecture:** Improve the existing context, curriculum, topic UI, scheduling calendar and content-maintenance paths. Reuse FSRS, project checkpoints, skill checks, Obsidian links and ordinary relational storage. No new scheduling algorithm, notes platform or speculative planning subsystem.

**Spec:** `docs/reviews/2026-09-25-learning-system-review.md`, explicitly approved for implementation by the user.

**Tech stack:** Existing TypeScript/Nest/Prisma/React/Yarn/Oxc stack; no new product dependencies unless an essential capability is unavailable.

## Constraints and execution decisions

- Preserve reviews, source evidence, application records, topic IDs, project progress and user-authored notes.
- Preserve unrelated pre-existing edits in deployment files and the untracked personal plugin.
- Do not perform learning exercises or award completion on the learner's behalf.
- Keep recommendations explicitly marked conditional/later out of this implementation (bundle splitting, new planning UI, multiple new university curricula).
- Existing review supplied the design and acceptance criteria; the user explicitly authorized implementing it. Continue without repeating approval gates from generic skills.
- Work in the existing checkout so local dependencies and the user's uncommitted context remain available. A dedicated branch was attempted twice, including with escalation, but filesystem protection denied the Git ref write. No commits, deployment or destructive data resets.
- The user selected Terrain as the canonical notes home, with configurable external references. Writes to the separate practice repository failed even after escalation; a tested guarded patch is prepared instead.

## Review focus

1. Previously mastered topics with failed recall must retain their history without being unconditionally trusted.
2. Completed chapter containers must convey descendant evidence without infinite traversal or unrelated-topic leakage.
3. Curriculum updates must preserve learner progress and custom prerequisites; changing JSON alone is insufficient for existing imports.
4. User-local midnight and DST transitions must agree across queues, dashboard and streak evaluation.
5. Note rendering and artifact links must remain safe with arbitrary imported text and URLs.

## Tasks

### 1. Reliable learning context

- [x] Add failing context tests for failed recall on active/mastered prerequisites, unresolved independent checks, and learned descendants of planned chapter containers.
- [x] Include relevant descendant evidence and exclude organizational containers from leaf knowledge assumptions. Keep malformed/cyclic protections.
- [x] Add an explicit verification-needed classification/reason using available evidence without changing stored completion history.
- [x] Verify context, shared schema, session export and MCP integration consumers.

Files: `apps/api/src/learning/learning-context.service.ts`, its tests, `packages/types/src/index.ts` and context tests; session consumers if required.

### 2. Notes and evidence UI

- [x] Put summary, canonical note and useful artifacts before management controls; render the supported note formatting safely using existing facilities or minimal native elements.
- [x] User clarification: store full editable canonical notes in Terrain for multiple devices, with optional external links. Add learner-owned notes distinct from imported AI summaries, with stale-write protection so a second device cannot silently overwrite newer work.
- [x] Include summary/description in text search with a user-focused regression check.
- [x] Distinguish historical study status, recall, application and dated independent assessment. Keep mastery rules as progress criteria, and centralize duplicated criteria if needed by the change.
- [x] Allow intentional reuse/linking of existing project evidence without automatically awarding review grades or mastery.
- [x] Improve the vault/timezone setup affordances and provide a reusable note/study guide.

Files: `apps/web/src/components/TopicDetailPanel.tsx`, `screens/Topics/index.tsx`, existing skill-check/project components, `lib/format.ts`, settings, shared mastery criteria where applicable.

### 3. One learner calendar and clear review streak

- [x] Write failing tests around midnight and DST in user settings timezones.
- [x] Reuse the existing timezone utilities for metrics and streak evaluation, including cron and skip-day paths.
- [x] Label streak/heatmap as review activity rather than all learning; do not change past logs blindly.
- [x] Verify daily queue, skill checks, metrics and streak tests together.

Files: metrics/streak services and tests, `telegram.time.ts`, dashboard and date-label helpers as needed.

### 4. Curriculum dependencies and durable upgrades

- [x] Add content-policy regressions: early RPC/viem and minimum tool bootstrap accessible with real prerequisites; AMM study precedes advanced DeFi attacks; unrelated frontier strands are independent.
- [x] Replace universal phase gates with explicit required foundations while preserving all topics and authored study order.
- [x] Implement an explicit, idempotent prepared-course update path for existing imports. Update only authored curriculum metadata/edges with preview and preservation checks; never mark lessons learned.
- [x] Reclassify long card exercises as bounded recall prompts with full practice retained in topic task descriptions.
- [x] Add a compact DSA foundation sequence and primary source plans; retain existing problem practice and add mixed-transfer guidance.
- [x] Refresh the identified moving sources after checking primary references; record actual review dates and version scope.

Files: `content/web3/*.json`, `content/dsa/*.json`, content validation scripts/tests, course manifest/service/controller/tests and Courses UI.

### 5. Project and study workflow

- [x] Align project catalogue guidance with one active project and the wallet/indexer/escrow then DeFi progression, retaining all twelve projects.
- [x] Supply canonical topic-note and architecture-decision templates, a weekly routine and a four-week starting checklist as usable documents.
- [x] Integrate a discoverable guide into existing UI without a new planning subsystem.

Files: project catalogue, existing Projects/Courses/Settings UI, `docs/learning/` documents.

### 6. Connector diagnosis and end-to-end verification

- [x] Reproduce available MCP protocol/auth/context boundaries, distinguishing unavailable client tools from server errors.
- [ ] Diagnose and fix the deployed connector error. Local SDK discovery/calls and safe error logging pass; the connector tool is unavailable in this session and no deployed root cause was established. Do not infer a fix from local tests.
- [x] Replace the stale scaffold end-to-end test with a meaningful authenticated study/export/import/resume flow using the existing test infrastructure.
- [x] Run HTTP checks with permitted local sockets when possible; retain precise environmental limitations otherwise.

Files: MCP service/controller/config and tests as evidence requires; `apps/api/test/app.e2e-spec.ts` and test command configuration.

### 7. Existing practice artifacts and documentation

- [ ] Apply the prepared private-key logging/public-fixture fix to the original practice repository. The guarded patch is tested; original writes remain blocked by filesystem permissions.
- [ ] Apply the prepared address assertion and ordinary test-entry-point changes to the original practice repository. Passed in a temporary copy; original writes remain blocked.
- [x] Document the Merkle exercise's demonstrated scope and remaining generalization as learner work, without implementing the assessed exercise for them.
- [x] Update Terrain contributor instructions from SM-2 and stale counts to the actual architecture and commands.

Files: relevant existing files in `web3-practice` with authorized filesystem access; Terrain `AGENTS.md` and learning guide.

### 8. Final verification and handoff

- [x] Run appropriate full workspace tests, content validation, lint, formatting and production compilation.
- [x] Review the full diff for regressions, sensitive output, unrelated changes and missing review recommendations.
- [ ] Complete live UI smoke testing. Component regression checks and the production web build pass; the local preview cannot bind a listening socket (EPERM).
- [x] Record completed work and any external-state blockers; keep deployment separate and report the concrete ready-to-deploy result.

## Progress ledger

- Planning: created from the user-approved review. Pre-existing test limitations: API HTTP sockets denied; stale end-to-end import type; default build cannot remove an existing generated directory. Current session's Terrain skill is present but no Terrain MCP tool is callable in the tool inventory. Do not invent a successful connector retest.
- Ruling: the user's explicit cross-device clarification supersedes the review's recommendation to use Obsidian as the canonical store. Keep optional Obsidian/HTTPS links; provide plain Markdown notes in Terrain without a new editor dependency.

- Implementation: tutor verification-needed evidence, prerequisite leaf expansion, learner-owned notes with revision conflicts and Markdown recovery, note search, separate evidence labels, one saved timezone, local-day streak evaluation, explicit curriculum reconciliation, stable study order, DSA foundations, bounded recall prompts, refreshed moving references, project guidance and reusable study documents are implemented.
- Notes scope: personal writing stays separate from imported summaries and is not automatically scored as independent competence or added to tutor context. Markdown export and optional external references provide portability.
- Review: the independent implementation review found draft loss on a cached-topic refetch error and unstable lesson order after bulk creation. Both received regression tests and fixes; the follow-up review reported no remaining must-fix finding within its inspected scope.
- Final verification: 646 API, 85 web, 40 shared-contract, 4 scheduler and 24 content/import checks pass (799 total). Forty-four API HTTP tests and two new HTTP end-to-end tests cannot listen on local sockets; the suite is not fully green. Broad API and web type checks, production compilation to temporary output directories, Prisma schema validation, lint, formatting and diff whitespace checks pass.
- Runtime status: two additive migrations are prepared, not applied; no live curriculum updates, settings changes, commits or deployment occurred. Database concurrency and browser smoke checks remain rollout gates. The existing Git ref write restriction prevented branch creation.
- Handoff: see `docs/learning/implementation-status.md` for the changed behavior, verification evidence, remaining work and exact rollout order. The historical review remains unchanged so its original observations are not confused with implementation evidence.
