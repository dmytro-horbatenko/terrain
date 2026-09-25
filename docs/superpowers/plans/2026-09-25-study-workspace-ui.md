# Study workspace UI implementation

User-approved scope: the four improvements in the UI assessment—full topic reading,
comfortable/recoverable editing, import-to-notes handoff, discovery and a focused
dashboard—plus fixing auto-preview when chat output starts with notes.

Continue in the existing checkout, initially clean at `a98c2f0`. No commits or
deployment. Reuse the existing React, Query and Router components; no editor
framework, second notes system or database migration. Saved-note version history
remains a later safeguard, as described in the assessment.

## Work and ownership

- [x] Notes editor: `TopicNotes.tsx`, its tests and local styles. Read/edit/preview,
  keyboard save, clear status and account/topic-scoped recoverable drafts in each tab.
  Preserve revision conflict handling; failure to access browser storage must not
  lose the in-memory draft or block downloading/saving it.
- [x] Discovery: topics search/service and Topics screen. Return bounded matching
  excerpts, recently edited notes and useful links without returning whole private
  notes in the topic list. Keep ownership filtering and accessible navigation.
- [x] Import handoff: both Import and Session screens. Recognize a complete
  learning-os block anywhere in a response; invalidate stale previews on input
  changes; offer direct topic-note links after successful import, including newly
  created topics. Longer notes remain a manual paste, clearly explained.
- [x] Reading page: `/topics/$topicId`, shared topic content, stable direct URL,
  quick-drawer expansion, comfortable reading width, anchored notes and secondary
  controls below the reading content. Use existing components to avoid drift.
- [x] Dashboard: keep review/learning, current project and due checks prominent;
  make detailed progress/statistics expandable. Link to recently edited notes.
- [x] Verify: focused behavioral tests, full web suite, relevant API tests, type
  checks, lint/format and production build; independent final review. Attempt
  desktop/mobile browser verification and report any remaining environment limit.

## Review focus

Draft recovery must not cross accounts, hide remote changes or overwrite a newer
revision. Saved and recovered text must survive preview toggles and failed saves.
Storage failures need truthful status and a recovery path. Topic navigation must
preserve unsaved-work warnings. Search must show where a match occurred and never
leak another user's notes. A late preview response must not authorize changed
input. Import completion links must point to actual persisted topic IDs.

## Verification ledger

Implemented in the current working tree; no commits or deployment.

- Full web suite: 108 tests passed across 15 files, including direct bookmarked
  topic rendering, dashboard operation with failed secondary statistics, import
  response races, draft recovery and cross-tab isolation.
- Relevant API suite: 65 tests passed across discovery, notes, DTO validation and
  topic service tests. Recent notes query is parameterized and owner scoped;
  filtered search applies its 100-result limit after domain/status restrictions.
- Web and API TypeScript checks passed. Whole-repository lint, formatting and
  `git diff --check` passed.
- Production web bundle passed to `/private/tmp/terrain-study-workspace-final-build`.
  Default generated output/cache directories reject writes with EPERM. The
  pre-existing large bundle warning remains; no new dependencies were added.
- Independent review found and verified two fixes: tab-isolated draft recovery
  and scrolling to a topic section after uncached content loads. No remaining
  important review findings.
- Live desktop/mobile browser verification remains blocked. Local serving fails
  with `listen EPERM` even with an approved escalation. A standalone sample-data
  UI fixture built successfully, but browser policy rejected its file URL. No
  alternate browser surface or policy workaround was attempted. The temporary
  fixture entry was removed from the repository. No live API/database smoke was
  completed.

## Recovery scope and use

Open a topic's full page from Topics, recent notes or an import result. Read shows
saved notes; Preview shows the working draft; Edit preserves the same draft.
Save notes (or Ctrl/Cmd+S inside the notes section) saves across devices. Unsaved
text survives refresh/navigation within the same tab, independently of other
accounts, topics and tabs. Save or download before closing the tab. Storage
failures and newer server revisions are explicit and never silently replace the
draft. Saved-note version history remains deferred.

After importing chat output, follow a processed topic link and manually paste its
longer explanation into Your notes. Import continues to save the compact session
summary separately. Both import screens recognize a learning-os block following
Markdown notes and discard previews as soon as the input changes.

The dashboard prioritizes today's study, the most recently updated active
milestone, recent notes and due skill checks. Detailed activity and progress are
available in expandable sections.
