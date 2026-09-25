# Learning-system implementation status

25 September 2026. Changes are in the local working tree, uncommitted. They have
not been deployed and have not changed the live learning database.

The original [review](../reviews/2026-09-25-learning-system-review.md) remains a
historical assessment. The user's later decision supersedes its Obsidian-first
recommendation: **Terrain is the canonical, editable notes home across devices**;
external tools remain optional.

## Implemented

| Area | Result |
|---|---|
| Tutor assumptions | Recent failed recall or an unsuccessful latest independent check requests verification, including for a historically mastered topic. Stored progress is preserved. |
| Prerequisite context | Organizational chapters convey descendant lesson evidence; containers are not treated as unstudied lessons. |
| Personal notes | Account-owned topic notes, safe basic Markdown, explicit save, stale-write protection, conflict comparison, draft recovery/export and navigation warnings. Imported summaries stay separate. |
| Finding and reading knowledge | Topic search includes descriptions, summaries and personal notes. Notes, summaries and references appear before management controls. |
| Evidence | Dated recall, applications and independent checks remain distinct. Personal writing or a project link does not automatically award mastery. |
| Study calendar | Queue, metrics, date labels and review-streak evaluation use the saved timezone, with DST-aware day boundaries. Settings offers the device timezone without silently changing it. |
| Curriculum | All 462 Web3 entries and 526 cards remain. Broad phase gates become concept prerequisites; twelve long labs retain their full tasks with shorter recall cards. |
| Existing imports | Courses offers an explicit update preview. Updates preserve learner progress, notes, IDs, review history and customized fields; a stale preview is rejected. Prepared lessons have explicit study order. |
| DSA | Five foundation lessons and one group added: 106 entries and 313 cards total. Existing problems remain; foundations have source plans. |
| Sources | Identified moving OP Stack, oracle, restaking, ZK/tooling and security references were checked and updated with actual scope/dates. This is not a factual audit of every source or an execution of every lab. |
| Projects | All twelve projects and 76 milestones remain, with one-active-project guidance, wallet → indexer → escrow progression, reuse and architecture decisions. Project guidance now reaches exported session context. |
| Study setup | An in-app routine plus [weekly workflow and four starting weeks](study-workflow.md), [topic-note template](topic-note-template.md), and [decision template](architecture-decision-template.md). |
| Integration checks | The obsolete scaffold end-to-end test is replaced by authenticated export → preview → import → resume checks, including ownership and duplicate import rejection. MCP discovery and calls also run through the SDK in memory. |

The notes feature is online storage through Terrain's existing account and
database. It does not promise offline synchronization or automatic merging.
Conflicting edits are kept for comparison; saving a newer revision requires the
learner to resolve the draft deliberately. Personal notes are not automatically
included in tutor exports or treated as assessment evidence.

Follow-up requested by the learner: learning-session instructions now require
copyable Markdown notes for each substantially studied topic alongside the usual
compact import summary. The learner pastes and saves the longer note manually.
Supplying an existing note to chat enables consolidation; no automatic note import
or overwrite was added. This instruction change also awaits deployment.
Follow-up verification: 131 session/export/import tests passed, as did lint,
formatting and a parser smoke check containing both Markdown notes with a code
example and the session JSON. The importer reads only the compact session record.

Review streaks retain their existing meaning: a review habit, including quiet
days with no active-topic reviews due. They do not count all learning. Historical
logs are preserved. Missing-day catch-up uses the currently stored due schedule;
it cannot reconstruct past due states that were never recorded.

## Verification

| Check | Result |
|---|---|
| API default tests | 646 passed; 44 HTTP tests failed at socket setup with `listen EPERM` in the two existing MCP/OAuth controller suites. |
| Web tests | 85 passed in 12 files, including note conflicts/recovery and preserving a draft on background topic errors. |
| Shared contracts / scheduling engine | 40 / 4 passed. |
| Content and import scripts | 24 passed. Web3: zero structural errors or coverage gaps. DSA: zero structural errors. |
| Production compilation | Shared packages built; broad API type check including end-to-end sources passed; API emitted successfully to `/private/tmp/terrain-final-api-build`; web type check and Vite build passed to `/private/tmp/terrain-final-web-build`. |
| Prisma schema | Validated with a dummy URL; no connection to a database and no migration applied. |
| Lint / formatting / whitespace | Passed. |
| New HTTP end-to-end flow | Both tests blocked at socket setup by `EPERM`; source type checks pass. A direct-service smoke using the same fixture passed, but does not substitute for HTTP coverage. |
| Browser smoke | Blocked: the preview server cannot bind `127.0.0.1:5180`. Component tests do not substitute for this check. |
| Independent implementation review | Draft-loss and bulk-import ordering findings fixed with regressions. Follow-up review reported no remaining must-fix finding in the inspected implementation. |

There are **799 passing checks**, but the whole test suite is **not green**.
No real PostgreSQL migration/concurrency test or live browser validation was
completed. The ordinary build also encounters protected old output directories;
temporary outputs verified compilation without deleting those directories.
The existing large web-bundle warning remains; splitting it is deferred until
startup performance warrants the work.

## Remaining work

1. **Roll out and validate the database changes.** Two additive migrations are
   ready: `20260925000001_topic_notes` and `20260925000002_curriculum_order`.
   They add a separate notes table and a nullable order field. They do not reset
   progress or automatically rewrite imported curricula.
2. **Resolve the deployed connector incident.** The earlier live `-32603` error
   has no established root cause. This session exposes no callable Terrain tool.
   SDK discovery/calls and existing safe server error logging pass locally.
   Reconnect/check the installed connector, call once without a topic and once
   with an owned topic, and correlate any failure with server logs. A successful
   browser session alone does not validate the connector. Copied session exports
   remain the fallback.
3. **Apply the practice hygiene patch.** The separate practice repository denied
   writes even after escalation. Its files remain unchanged. The
   [guarded patch and instructions](practice-hygiene.md) were tested in a temporary
   copy: three TypeScript checks and the existing Foundry scaffold pass. The
   learner's assessed exercises were not completed for them.
4. **Run HTTP and browser checks where local sockets are allowed.** Include
   simultaneous note saves from two signed-in tabs/devices and a stale course
   update preview. Confirm the conflict leaves the draft and recorded learning
   data intact.

## Rollout order

Use the project's existing deployment procedure and configured database
credentials. These steps are instructions, not actions performed in this task.

1. Verify a restorable database backup and use the normal release environment.
2. Apply migrations before starting the updated API:

   ```bash
   yarn workspace @terrain/api exec prisma migrate deploy
   yarn workspace @terrain/api exec prisma generate
   yarn build
   ```

3. Run `yarn test` and `yarn workspace @terrain/api test:e2e --runInBand` where
   HTTP listeners are permitted, then deploy the matching API, web and bundled
   `content/` files together.
4. Sign in and verify notes, search, conflict handling, date labels and session
   export/import/resume. Save the intended timezone in Settings.
5. In Courses, use **Review curriculum updates** for Web3 and DSA. Inspect any
   preserved custom changes or blocking issues, then **Apply reviewed update**.
   Re-preview afterward: it should propose no additional authored changes.
   Do not delete and reimport courses. Learning progress is not migrated by
   marking lessons complete.
6. Retest the live connector and apply the separate practice patch as described
   above. The existing project checkpoint version checks remain in place; if an
   old checkpoint import reports a catalogue mismatch, start a new export from
   the current project instead of relabeling an old export.

No commits or deployment were made. Git branch creation failed with filesystem
`EPERM`, so work remains on the original branch. Pre-existing edits to
`docker-compose.prod.yml`, `docs/ops/deploy.md`, and the untracked `plugins/`
directory were left intact.
