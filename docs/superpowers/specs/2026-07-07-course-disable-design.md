# Disable a course from active scheduling

## Problem

Terrain has no way to pause a course. If you want to focus solely on Web3
right now, DSA topics still surface in Next Up, due cards, the dashboard,
and Telegram digests/nudges — there's no way to say "stop scheduling this
domain until I re-enable it."

Separately, the Courses screen's `imported` flag is wrong for DSA: it was
seeded via a script rather than the Courses UI import flow, so no
`CourseImport` row exists for it, even though its topics are fully active.
The screen shows DSA as not-imported when it plainly is.

## Goals

- Let a user pause (disable) a course so its topics stop appearing in every
  scheduling surface: dashboard, Next Up, due cards, new-card counts, the
  AI session export, and Telegram digest/nudges.
- Re-enabling is instant and lossless — no SR history or topic data is
  touched, only whether the domain is currently scheduled.
- Fix `imported` to reflect reality (derived from actual `Topic` rows for
  that domain) rather than the `CourseImport` tracking table, so drift like
  the DSA case can't happen again.

## Non-goals

- Roadmap screen browsing/editing is unaffected — a disabled course's
  topics remain visible and editable there. Only scheduling pauses.
- No change to how courses are imported, or to `CourseImport`'s purpose
  (it still records *when* an import ran via the Courses UI).

## Data model

Add one field to `Settings`:

```prisma
model Settings {
  ...
  disabledDomains String[] @default([])
}
```

A course maps 1:1 to a `domain` (`COURSE_MANIFEST[].domain`, e.g. `DSA`,
`Web3`). "Disable a course" means adding its domain string to this array.
No new table — this reuses the existing per-user settings row, consistent
with how other per-user scheduling preferences live there.

## API

`CoursesService`:
- `list(userId)`: compute `imported` by checking whether any `Topic` rows
  exist for that domain (`prisma.topic.count({ where: { userId, domain } })
  > 0`), not by looking up `CourseImport`. Add `disabled: boolean` to
  `CourseSummary`, read from `Settings.disabledDomains`.
- `setDisabled(userId, courseId, disabled)`: resolves the course's `domain`
  via `COURSE_MANIFEST`, then upserts `Settings.disabledDomains` to add or
  remove that domain.

`CoursesController`: `PATCH /courses/:id/disabled` with body
`{ disabled: boolean }`, returns the updated `CourseSummary`.

## Scheduling enforcement

`MetricsService` is the chokepoint every "what should I study" surface goes
through (`dueTopics`, `dueCards`, `sessionQueue`, `startablePlannedIds` /
`newCardsCount`, `nextUp`, `dashboard`) — directly for the dashboard/Next Up
API, and indirectly via `export-generator.service.ts` (AI session export)
and `telegram.cron.ts` (digest/nudges), neither of which pass an explicit
`domain` today.

Add a private helper to `MetricsService`:

```ts
private async disabledDomains(userId: string): Promise<string[]> {
  const settings = await this.prisma.settings.findUnique({
    where: { userId },
    select: { disabledDomains: true },
  });
  return settings?.disabledDomains ?? [];
}
```

Every query in `MetricsService` that currently does
`...(domain ? { domain } : {})` becomes:

```ts
...(domain ? { domain } : disabled.length ? { domain: { notIn: disabled } } : {})
```

with `disabled` resolved once per top-level call (e.g. once in `dashboard`,
passed to its parallel sub-calls; once each in the standalone methods
`dueCards`/`dueTopics`/`nextUp` when called directly by
`export-generator.service.ts` / `telegram.cron.ts`).

Explicit `domain` always wins over the exclusion list — nothing in the
codebase currently passes an explicit domain that could itself be disabled,
so this ordering is safe and simple.

Because `telegram.cron.ts` and `export-generator.service.ts`'s full-mode
roadmap listing call these methods without a domain, disabling a course
automatically stops it from generating due-cards, Next Up entries, or
Telegram nudges — no changes needed in those files beyond what
`MetricsService` already does internally.

## UI

Courses screen (`apps/web/src/screens/Courses`):
- `CourseSummary`/`Course` type gains `disabled: boolean`.
- `CourseCard` gets a second, small button next to Import: "Pause" when
  active and enabled, "Resume" when disabled. Only shown once a course is
  imported (nothing to pause before topics exist).
- `buttonState.ts` gains a pure function, e.g.
  `courseDisableButtonState(course, isPending): 'pause' | 'resume' | 'pausing' | 'resuming'`,
  following the existing `courseButtonState` pattern.
- New hook `useSetCourseDisabled()` in `api/hooks.ts` wrapping the `PATCH`
  endpoint, with an optimistic/toast pattern matching `useImportCourse`.

## Testing

- `MetricsService`: unit tests asserting `dueTopics`/`dueCards`/`nextUp`/
  `newCardsCount` exclude topics whose domain is in `disabledDomains` when
  no explicit `domain` is passed, and that an explicit `domain` still works
  (existing per-domain filtering behavior untouched).
- `CoursesService`: unit test that `imported` reflects actual `Topic`
  existence (covers the DSA script-import case) and that `disabled`
  reflects `Settings.disabledDomains`; unit test for `setDisabled` adding/
  removing a domain idempotently.
- `buttonState.test.ts`: cases for the new pause/resume state function.

## Migration

One additive Prisma migration (`disabledDomains String[] @default([])` on
`Settings`) — no backfill needed; existing rows default to `[]`.
