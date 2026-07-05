# Daily Loop UX — Today Ritual, Next Up CTAs, Session Breadcrumb, Import Ergonomics — Design

**Date:** 2026-07-03
**Status:** Approved (review 2026-07-03 — original Next-Up-CTA-only proposal expanded
to the full daily-loop UX after assessment; the CTA swap is Part 1 below)
**Scope:** `apps/web` Dashboard + Import screens, plus two additive fields on the
dashboard metrics payload (`apps/api`). No schema changes, no contract changes,
no new endpoints.

## Problem

The Dashboard's daily loop (built by the Interleaved Review Session and AI Session
Loop plans) has the right machinery but the wrong surface:

1. **The Next Up card's primary `Start` is legacy.** It PATCHes the topic to
   `active` and opens `ReviewGate` → `LogReviewForm` — asking the user to
   self-grade material they haven't studied, with no card content behind it
   (a fresh topic has no prompts, so `ReviewGate` falls through to a bare grade
   form). The intended entry point — copy the `learn` export, have the Socratic
   session in Claude, import the `learning-os` block (which activates the topic
   via `studiedTopics` and unblocks successors) — sits in the secondary slot.
2. **The loop has no in-flight state.** After copying a learning/repetition
   context, the topic stays `planned`, the card looks unchanged, and nothing
   anywhere says "a session is out there waiting to come back." If the user does
   the Claude session and forgets to import, the result silently drops. The data
   already exists (`SessionExport.mode` + `importedAt: null`) — the export text
   even tells *Claude* about un-imported sessions while the UI tells the user
   nothing.
3. **Dashboard order fights the ritual it teaches.** The learning-science
   ordering the app promotes is: clear due reviews first, then learn one new
   thing. The Dashboard inverts and scatters this — Next Up (learn) sits near the
   top while `▶ Review all (N)` is buried below the struggle gauge, library
   badges, and heatmap.
4. **The return path is heavier than the outbound path.** Outbound is one click;
   inbound is navigate → paste → Preview → Apply, and after Apply the screen
   dead-ends instead of re-arming the loop.

## Decision

### Part 1 — Next Up CTAs (the original proposal, amended)

- **Primary:** `▶ Start learning` — wired to the existing
  `copyContext({ mode: 'learn' }, 'Learning context')`. Mirrors the repeat side's
  `▶ Review all (N)` as "begin this mode's main path."
- **Post-copy state (new):** after a successful copy, the button row swaps to a
  "what now" strip — *"Copied ✓ — paste into a fresh Claude chat… bring the
  `learning-os` block back to Import"* — with an `Open Import` link and a ghost
  `Copy again` button. The toast's disappearing instruction becomes the card
  teaching the ritual.
- **Secondary:** the old activate-then-grade behavior keeps its exact wiring
  (`onStart`), demoted to `btn-ghost btn-sm` and relabeled **`Studied
  elsewhere`** — intent-based, not mechanism-based ("Activate manually" was
  rejected as jargon). The grade modal after activation is *retained
  deliberately*: it seeds FSRS with a self-assessed first review for material
  learned outside the app. The same action also remains available in
  `TopicDetailPanel`'s status select, so ghost-level demotion loses nothing.
- The `!nextUp` blocked explainer and all `disabled`/loading behavior carry over.

### Part 2 — "Today" ritual card

The Next Up card becomes step 2 of a new **Today** card at the top of the
Dashboard (`apps/web/src/screens/Dashboard/TodayCard.tsx`, replacing
`NextUpCard.tsx`):

1. **Review** — `N cards · ~M min` meta line, `▶ Review all (N)` (opens the
   in-app session) + `⧉ Copy repetition context`. "Nothing due today — all
   clear." when the queue is empty. Minutes come from a new additive
   `sessionQueueMinutes` dashboard field (existing `estimateMinutes` heuristic).
2. **Learn** — the Part-1 card body (chapter line, title, snippet, redesigned
   CTAs). Blocked explainer when `!nextUp && planned > 0`; row hidden when the
   curriculum is exhausted.

The old standalone buttons row above "Due for review" is removed (it moved into
step 1). New Dashboard order: **Today → KPI row → struggle/library → heatmap →
due list**. The due list stays as reference detail.

### Part 3 — awaiting-import breadcrumb

The dashboard payload gains additive
`pendingSessions: { id, mode: 'repeat' | 'learn', generatedAt }[]` — for each of
the two loop modes, the **latest** `SessionExport` of that mode iff
`importedAt: null` and generated within the last **48h** (a breadcrumb, not a
nag; older un-imported duplicates from repeated clicks are naturally ignored
because only the latest row per mode is considered). The Today card renders each
as *"⏳ Learning context copied 2h ago — session not imported yet"* + a `Paste
results` link to Import. `useGenerateExport` invalidates the dashboard query so
the breadcrumb appears immediately after a copy; import-apply already
invalidates everything. While the learn post-copy strip is showing, the learn
breadcrumb is suppressed (they'd say the same thing twice).

### Part 4 — Import ergonomics

- **Auto-preview:** when pasted text contains a fenced `learning-os` block, run
  Preview automatically (debounced ~600ms, deduped against the last previewed
  text). The preview is a deterministic read-only diff — no reason to gate it
  behind a click. The manual button stays.
- **Loop re-arm:** the post-apply result card gains *"The loop is re-armed — the
  Dashboard reflects these changes"* + a `Back to Dashboard` link.

## Alternatives considered

- **Remove manual activation entirely:** rejected — fallback kept (demoted) for
  topics studied outside the app or when Claude isn't reachable.
- **Open claude.ai directly with the context (`claude.ai/new?q=…`):** rejected —
  learn exports (domain roadmap + goal + conduct) far exceed URL length limits;
  clipboard remains the transport. Revisit if/when an MCP connector replaces the
  copy-paste loop (strategic direction, out of scope).
- **Activate the topic at copy time:** rejected — activation-on-import is the
  design ("status mirrors reality"); a copied context that never becomes a
  session must not drift the roadmap. The breadcrumb is the middle state.
- **A separate `GET /sessions/pending` endpoint:** rejected — the dashboard
  payload is the natural carrier; it's already invalidated on every mutation
  that matters.

## Testing

- **API (jest):** `sessionQueue` returns `estimatedMinutes` (explicit
  `estimatedMinutes` + kind fallbacks); `dashboard` includes
  `sessionQueueMinutes` and `pendingSessions` (pending within window / imported
  excluded / >48h excluded / latest-per-mode wins).
- **Web (vitest):** `timeAgo` formatting. Component changes follow repo
  convention (no component-test infra): `yarn workspace @terrain/web build`
  (tsc is the type-correctness gate) + CDP smoke — Today card order and labels,
  post-copy strip, breadcrumb appearance after copy, Import auto-preview.
- **Full gate:** `yarn build && yarn test && yarn lint && yarn format:check`.
