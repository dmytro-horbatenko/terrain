# Topic notes and AI review

Personal notes describe material actually covered. AI references are stored
separately; their presence never activates a topic or proves mastery.

## Review one topic

1. Open the topic and select **Review this note with fresh AI**. The button
   reads the latest full text, revision and hash before copying its context.
   The reference panel has its own **Review reference with fresh AI** action.
2. Open a fresh AI conversation. Preserve the learner’s Russian explanations,
   examples, unfinished objectives and actual assistance. Verify uncertain or
   changing claims against primary sources. No changes is a valid finding.
3. Paste the returned `note-review` block into Import. A Learn session may return
   both `learning-os` and `note-review`; the learning record is saved first.
4. Compare the currently saved text with the proposal, reason and checked sources.
   Choose **Apply reviewed notes** or **Keep current text**. A no-change review
   records a receipt without increasing the content revision.

The read-only MCP tool `get_topic_note_review_context` is another way to obtain
one owned topic’s complete text. It omits other topics and pending independent
assessment payloads. During recall, access answer-containing notes only after
an unaided first attempt; never use this flow to solve an independent check.

The strict proposal schema lives in `packages/types/src/note-review.ts`.
It is separate from the existing `learning-os` v2 contract. An AI proposal is
not saved until the learner explicitly accepts it in the app.

## Conflicts and interrupted saves

The server compares both revision and content hash. A stale proposal cannot
replace a newer edit; merge useful parts in the existing editor or request a
fresh review. Stable review IDs identify exact proposals, so retries return the
original receipt without duplicating edits or replaying learning grades.

Pending proposals are stored in sessionStorage for the current account and tab.
After reload, open Import with an empty paste field or the corresponding topic.
The linked session’s import status is read from the server. **Check session save**
repeats only that read. If a note save succeeded but its response was lost, the
preview displays **This proposal was already saved**; newer text stays current.
**Dismiss saved proposal** removes the local pending copy. Storage failures are
shown explicitly; copy the proposal before leaving if recovery is unavailable.

Text history records content versions, origin and AI review reasons/sources.
**AI reviewed this version** applies only to that exact version. It is neither
independent assessment evidence nor verification of the rest of the library.

## Deployment

Deploy API and web from the same source revision using `docs/ops/deploy.md`.
Take and verify a full database backup before applying migration
`20261003120000_topic_writing`. It adds TopicReference and TopicWritingRevision,
and records existing note baselines without changing their bodies, revisions
or timestamps. Apply the migration before serving the new UI.

References start unreviewed. Importing an existing private archive is a separate,
owner-scoped maintenance operation, never a seed for every user. Keep exports,
generated personal material and one-off operator tools out of version control.
Verify archive hashes and preserve learning records, schedules and edited text.

To roll back the application, retain the additive tables and immutable history;
the previous API ignores them. A full database restore requires accounting for
learning work recorded after the backup.

## Verification

Run the repository’s lint, format, tests and builds. Writing integration tests
use migrated disposable PostgreSQL-compatible storage; they never connect to
production. HTTP integration tests require permission to bind local ports.

Before release, smoke-test both desktop and a 390px viewport:

- Current chapter, started counts and roadmap return navigation.
- Separate reference panel and current-text review context.
- Paired learning/note paste, notes-only paste and no-change review.
- Stale proposal, lost response, reload recovery and later manual edit.
- Keyboard focus, touch targets, long URLs/code and wrapped comparisons.

The sandbox validation did not include interactive browser smoke. Complete
these checks in an environment where the app can run before release.
