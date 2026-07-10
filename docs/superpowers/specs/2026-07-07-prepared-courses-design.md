# Prepared Courses — Design

## Problem

Terrain ships pre-authored curriculum content (`content/dsa/*.json`, 18 files;
`content/web3/*.json`, 17 files) in the `learning-os v2` format that the
Import feature already understands. Today the only way to get this content
into a user's account is a one-off CLI script
(`scripts/import-dsa.mjs`/`scripts/import-web3.mjs`) that logs in and drives
the manual paste-JSON Import screen programmatically. There's no in-app way
for a user to discover these prepared courses or import them with a click.

## Goals

- Users can browse the prepared courses (DSA, Web3) on the website.
- One click imports a whole course into the user's own roadmap/topics.
- The UI shows which courses have already been added.
- Extending to a future third course is a small, code-level addition (new
  manifest entry), not a schema change.

## Non-goals

- Course content authoring/editing UI — content files are still authored by
  hand and validated via `scripts/validate-*-content.mjs`.
- Syncing already-imported topics when course content changes later, or
  detecting drift if the user edits/deletes imported topics. The user is free
  to freely modify, extend, or delete topics after import; "added" is a
  one-time completion marker, not a live sync state. (Deferred: could add an
  explicit "sync" action in the future.)
- Per-file or per-chapter import granularity — a course is imported as one
  unit (all its files).
- A preview/confirm step before import — content is pre-authored and
  validated, so import commits directly.

## Architecture

### Course manifest

A small static config lives in `apps/api` (e.g.
`apps/api/src/courses/course-manifest.ts`), not a new content file format:

```ts
{
  id: 'dsa',
  domain: 'DSA',
  title: 'Data Structures & Algorithms',
  description: '...', // reuses the root topic's description
  files: ['content/dsa/01-arrays-hashing.json', ...], // ordered
}
```

One entry per course (`dsa`, `web3` today). Adding a future course means
adding one manifest entry and dropping content files in
`content/<domain>/`.

### Persisted "added" state

New Prisma model:

```prisma
model CourseImport {
  id         String   @id @default(cuid())
  userId     String
  courseId   String
  importedAt DateTime @default(now())

  @@unique([userId, courseId])
}
```

A row's existence is the sole source of truth for "added" in the UI. This is
deliberately not a live diff against the user's current topics — per the
non-goals above, the user is expected to modify/delete imported topics
freely without that affecting the "added" badge.

### API (`apps/api/src/courses/`)

- `GET /courses` — for each manifest entry, returns
  `{ id, domain, title, description, topicCount, imported }`, where
  `imported` comes from a `CourseImport` lookup scoped to
  `@CurrentUser()`. `topicCount` is computed by reading and summing
  `proposedTopics.length` across the course's files.
- `POST /courses/:id/import` — looks up the manifest entry, then for each
  file in order: reads the JSON, builds the same fenced
  `` ```learning-os\n<json>\n``` `` payload the existing Import screen and
  scripts use, and calls `ImportService.preview()` then `.apply()` in-process
  (no HTTP round-trip, no login) scoped to `@CurrentUser()`. This reuses the
  existing dedup-by-title behavior, so re-running an already-imported course
  is a safe no-op. Only after every file applies successfully does the
  handler upsert the `CourseImport` row and return a summary
  (`{ topicsCreated, promptsCreated, topicsActivated }` totals across files).
  On a failure partway through, whatever topics were already created from
  earlier files in the loop stay (no rollback), no `CourseImport` row is
  written, and the error propagates so the client can show a retry state.

### Deployment

The runtime Docker image (`apps/api/Dockerfile`) currently does not copy
`content/` into the image. This needs:

```dockerfile
COPY --from=build /workspace/content ./content
```

placed so it lands at a path the compiled API can resolve consistently in
both dev (running from the repo root) and prod (`WORKDIR
/workspace/apps/api` in the runtime stage). The manifest's file paths should
be resolved through a single constant (e.g. an env-overridable `CONTENT_DIR`
defaulting relative to the compiled module location) rather than hardcoded
relative paths scattered across the module.

## Web UI

New screen `apps/web/src/screens/Courses/index.tsx` at route `/courses`,
plus a nav entry alongside the existing screens (Roadmap, Import, etc.).

Each course renders as a card: title, description, domain badge, topic
count, and an action button with three states:

- **Import** (course not yet added) — click calls `POST /courses/:id/import`.
- **Importing…** (in flight) — spinner, button disabled.
- **Added** (imported === true) — badge/disabled state, not clickable.

On import failure, show an inline error and revert the button to the
**Import** state so the user can retry.

## Data flow summary

1. User opens `/courses`. Web calls `GET /courses`.
2. User clicks **Import** on a course card.
3. Web calls `POST /courses/:id/import`.
4. API loops the course's files through the existing `ImportService`
   preview/apply pipeline for that user, then upserts `CourseImport`.
5. Web receives the summary, flips the card to **Added**.

## Testing

- API: unit tests for `CoursesService` (manifest loading, topic counting,
  idempotent re-import, partial-failure leaves no `CourseImport` row) and
  controller auth-scoping (courses/import endpoints require
  `@CurrentUser()`, same as Import/Topics).
- Web: component test for the three button states and the card list
  rendering `imported` from the API response.
