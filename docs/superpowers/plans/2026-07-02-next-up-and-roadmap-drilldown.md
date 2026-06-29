# Next Up + Roadmap Drill-Down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a guided "Next up" study surface with a one-click Start verb (Phase 1) and make the Roadmap graph legible at 100+ nodes via chapter drill-down (Phase 2), preceded by a one-off DSA duplicate-topic cleanup.

**Architecture:** Phase 1 redefines the `blocked` predicate app-wide ("prereqs started", not "prereqs mastered"), scopes new-card counts to startable topics, and adds a `nextUp` field to the existing `GET /metrics/dashboard` payload, consumed by a new Dashboard hero card. Phase 2 is a pure client-side re-projection of the Roadmap: a new `projectRoadmap()` module turns the flat topic list into per-level nodes (groups / leaves / ghosts) with subtree-aggregated edges; parent edges disappear by construction. No schema migration anywhere.

**Tech Stack:** NestJS 11 + Prisma 7 (jest) for the API; React 19 + @xyflow/react + dagre (vitest added to `apps/web` for the pure projection module) for the web; Node 24 `.mjs` script for cleanup.

**Spec:** `docs/superpowers/specs/2026-07-02-terrain-next-up-and-roadmap-drilldown-design.md`

## Global Constraints

- **NO git commits.** Repo policy: work stays uncommitted unless the user explicitly asks. Every "commit" step habit is replaced by "leave in working tree".
- API runs on `http://localhost:3000`, **no `/api` prefix** (the web dev server on :5180 proxies `/api` → :3000; scripts talk to :3000 directly).
- Rate limit: global 100 req/min — script loops pace themselves (650 ms between calls).
- Kill the dev API with `kill -9 $(lsof -ti:3000)` — `pkill -f "nest start"` does NOT work and leaves a zombie holding :3000.
- Postgres runs in Docker on host port **5433** (`docker compose up -d` first).
- oxlint/oxfmt own style: run `yarn lint && yarn format:check` after each task; `yarn format` to fix.
- The monorepo is CommonJS for `apps/api` (extensionless imports); `apps/web` is ESM.
- `blocked` semantics after Task 2: a `planned` topic is blocked iff some **direct** prerequisite has status `planned` or `archived`. "Startable" = `planned` and not blocked. Every later task assumes this.

---

### Task 1: One-off DSA duplicate cleanup script

The 2026-07-02 import created 7 tentative duplicates of committed topics that carry real review history, and left studied topics at `status: 'planned'`. This script (spec §5) merges duplicates into their originals and activates reviewed topics. It works through the public API (auth-scoped, reuses cycle guards and the delete rule).

**Files:**
- Create: `scripts/cleanup-dsa-duplicates.mjs`

**Interfaces:**
- Consumes: existing API endpoints — `POST /auth/login`, `GET /topics`, `GET /topics/:id`, `PATCH /topics/:id`, `POST /topics/:id/prerequisites`, `DELETE /topics/:id`.
- Produces: nothing for later tasks (data cleanup only). Later smoke expectations assume it has run.

- [ ] **Step 1: Verify the current duplicate state (evidence before action)**

Run:
```bash
docker compose up -d && docker exec consistency-db-1 psql -U terrain -d terrain -tc "select title, count(*) from \"Topic\" where domain='DSA' group by title having count(*)>1 order by title;"
```
Expected: 7 rows (Arrays & Hashing, Data Structures & Algorithms, Hashing fundamentals, Opposite-direction pointers, Prefix sums, Two Pointers, Two Sum / complement lookup). If zero rows, the cleanup already ran — write the script anyway (it must be a no-op then) but expect "0 duplicate title groups" in Step 3.

- [ ] **Step 2: Write the script**

Create `scripts/cleanup-dsa-duplicates.mjs`:

```js
// One-off, idempotent cleanup after the 2026-07-02 DSA import (spec §5):
//   1. merge tentative duplicate topics into their committed originals
//      (survivor = most reviews, then oldest; twins must have no history)
//   2. set status=active on planned topics that already have review history
// Usage: node scripts/cleanup-dsa-duplicates.mjs [--dry-run]
// Env: TERRAIN_API (default http://localhost:3000), TERRAIN_EMAIL, TERRAIN_PASSWORD

const API = process.env.TERRAIN_API ?? 'http://localhost:3000';
const DRY = process.argv.includes('--dry-run');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const die = (msg) => {
  console.error(`FATAL: ${msg}`);
  process.exit(1);
};
const norm = (s) => s.trim().toLowerCase();

let cookie = '';
async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', cookie, ...init.headers },
  });
  const setCookie = res.headers.getSetCookie?.()[0];
  if (setCookie) cookie = setCookie.split(';')[0];
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, body };
}

async function login() {
  const { TERRAIN_EMAIL: email, TERRAIN_PASSWORD: password } = process.env;
  if (!email || !password) die('set TERRAIN_EMAIL and TERRAIN_PASSWORD');
  const r = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (r.status >= 300) die(`auth failed: ${r.status} ${JSON.stringify(r.body)}`);
  console.log(`authenticated as ${email}${DRY ? ' (dry run)' : ''}`);
}

async function fetchTopics() {
  const list = await api('/topics');
  if (list.status !== 200) die(`GET /topics failed ${list.status}`);
  return list.body;
}

async function detail(id) {
  const d = await api(`/topics/${id}`);
  if (d.status !== 200) die(`GET /topics/${id} failed ${d.status}`);
  await sleep(650);
  return d.body;
}

// ---- 1. merge duplicate titles (same domain, same normalized title) ----
async function mergeDuplicates() {
  const topics = await fetchTopics();
  const byKey = new Map();
  for (const t of topics) {
    const key = `${t.domain}::${norm(t.title)}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(t);
  }
  const dupGroups = [...byKey.values()].filter((g) => g.length > 1);
  console.log(`${dupGroups.length} duplicate title group(s)`);

  for (const group of dupGroups) {
    const details = [];
    for (const t of group) details.push(await detail(t.id));
    details.sort(
      (a, b) => b.reviews.length - a.reviews.length || a.createdAt.localeCompare(b.createdAt),
    );
    const [survivor, ...twins] = details;
    console.log(
      `"${survivor.title}": keep ${survivor.id} (${survivor.reviews.length} reviews), merge ${twins.length} twin(s)`,
    );
    for (const twin of twins) {
      if (twin.reviews.length > 0 || twin.appEventCount > 0) {
        console.warn(`  SKIP twin ${twin.id} — it has history too; resolve manually`);
        continue;
      }
      for (const dep of twin.dependents) {
        if (dep.id === survivor.id) continue; // that edge dies with the twin
        console.log(`  dependent "${dep.title}" += prerequisite "${survivor.title}"`);
        if (DRY) continue;
        const r = await api(`/topics/${dep.id}/prerequisites`, {
          method: 'POST',
          body: JSON.stringify({ prerequisiteId: survivor.id }),
        });
        if (r.status === 422) console.warn(`  (422 cycle — edge not re-pointed, review manually)`);
        else if (r.status >= 300) die(`add prerequisite failed ${r.status}`);
        await sleep(650);
      }
      for (const child of twin.children) {
        console.log(`  child "${child.title}" parent → survivor`);
        if (DRY) continue;
        const r = await api(`/topics/${child.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ parentId: survivor.id }),
        });
        if (r.status >= 300) die(`reparent failed ${r.status}`);
        await sleep(650);
      }
      console.log(`  delete twin ${twin.id}`);
      if (DRY) continue;
      const r = await api(`/topics/${twin.id}`, { method: 'DELETE' });
      if (r.status >= 300) die(`delete twin failed ${r.status} ${JSON.stringify(r.body)}`);
      await sleep(650);
    }
  }
}

// ---- 2. activate planned topics that already have review history ----
async function activateReviewed() {
  const topics = await fetchTopics();
  const planned = topics.filter((t) => t.status === 'planned');
  console.log(`sweeping ${planned.length} planned topics for review history (~1 min)...`);
  let activated = 0;
  for (const t of planned) {
    const d = await detail(t.id);
    if (d.reviews.length === 0) continue;
    console.log(`activate "${t.title}" (${d.reviews.length} reviews)`);
    activated++;
    if (DRY) continue;
    const r = await api(`/topics/${t.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'active' }),
    });
    if (r.status >= 300) die(`activate failed ${r.status}`);
    await sleep(650);
  }
  console.log(`${activated} planned topic(s) with review history${DRY ? ' (not applied)' : ' activated'}`);
}

await login();
await mergeDuplicates();
await activateReviewed();
console.log('DONE');
```

- [ ] **Step 3: Dry-run against the live stack**

Boot if needed (`docker compose up -d`, `yarn workspace @terrain/api start` in background). Ask the user for `TERRAIN_EMAIL` / `TERRAIN_PASSWORD` if not already exported (same account the DSA import used). Run:
```bash
node scripts/cleanup-dsa-duplicates.mjs --dry-run
```
Expected: `7 duplicate title group(s)`; for each, one survivor with reviews and one twin merged; a handful of `activate "<title>"` lines; no FATAL. Read the printed plan and sanity-check every survivor has more reviews than its twin (twins should all show 0).

- [ ] **Step 4: Real run**

```bash
node scripts/cleanup-dsa-duplicates.mjs
```
Expected: same actions applied, `DONE`.

- [ ] **Step 5: Verify idempotence + end state**

```bash
node scripts/cleanup-dsa-duplicates.mjs --dry-run
```
Expected: `0 duplicate title group(s)` and `0 planned topic(s) with review history`.
```bash
docker exec consistency-db-1 psql -U terrain -d terrain -tc "select count(*) from \"Topic\" where domain='DSA';" && docker exec consistency-db-1 psql -U terrain -d terrain -tc "select title from \"Topic\" where domain='DSA' group by title having count(*)>1;"
```
Expected: 102 topics (109 − 7 twins), zero duplicate rows. Run `yarn lint && yarn format:check` — clean. Leave in working tree.

---

### Task 2: Redefine `blocked` — prereqs started, not mastered (API)

**Files:**
- Modify: `apps/api/src/metrics/metrics.service.ts:27-28` (`topicLabels`)
- Test: `apps/api/src/metrics/metrics.service.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `topicLabels({status, cards, prerequisiteStatuses}): {blocked, reviewing}` — unchanged signature, new rule: `blocked === (status === 'planned' && prerequisiteStatuses.some(s => s !== 'mastered' && s !== 'active'))`. All later tasks (and the web `labels.blocked`) rely on this.

- [ ] **Step 1: Update + add failing tests**

In `apps/api/src/metrics/metrics.service.spec.ts`, **replace** the existing test `'topicLabels: blocked when planned with an unmastered prerequisite'` (which asserts `['active'] → blocked: true`) with these five (keep the other existing `topicLabels` tests as they are — they remain valid):

```ts
it('topicLabels: planned with an active prerequisite is NOT blocked (started gate)', () => {
  expect(
    service.topicLabels({ status: 'planned', cards: [], prerequisiteStatuses: ['active'] }),
  ).toEqual({ blocked: false, reviewing: false });
});
it('topicLabels: planned with a planned prerequisite is blocked', () => {
  expect(
    service.topicLabels({ status: 'planned', cards: [], prerequisiteStatuses: ['planned'] }),
  ).toEqual({ blocked: true, reviewing: false });
});
it('topicLabels: planned with an archived prerequisite is blocked', () => {
  expect(
    service.topicLabels({ status: 'planned', cards: [], prerequisiteStatuses: ['archived'] }),
  ).toEqual({ blocked: true, reviewing: false });
});
it('topicLabels: one unstarted prerequisite among started ones still blocks', () => {
  expect(
    service.topicLabels({
      status: 'planned',
      cards: [],
      prerequisiteStatuses: ['mastered', 'active', 'planned'],
    }),
  ).toEqual({ blocked: true, reviewing: false });
});
it('topicLabels: a non-planned topic is never blocked', () => {
  expect(
    service.topicLabels({ status: 'active', cards: [], prerequisiteStatuses: ['planned'] }),
  ).toEqual({ blocked: false, reviewing: false });
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `yarn workspace @terrain/api test metrics.service`
Expected: FAIL — `planned with an active prerequisite is NOT blocked` (and the two "blocked" cases pass by accident of the old rule; the `['active']` case must fail).

- [ ] **Step 3: Implement the predicate**

In `apps/api/src/metrics/metrics.service.ts`, change `topicLabels` (currently lines 27–28):

```ts
const blocked =
  input.status === 'planned' &&
  input.prerequisiteStatuses.some((s) => s !== 'mastered' && s !== 'active');
```

- [ ] **Step 4: Run the full API suite**

Run: `yarn workspace @terrain/api test`
Expected: all green (the whole suite, not just metrics — `topics.service.spec.ts` consumes `topicLabels` via mocks and must not regress). `yarn lint && yarn format:check` clean. Leave in working tree.

---

### Task 3: `newCardsCount` counts only startable/active/mastered topics' cards (API)

**Files:**
- Modify: `apps/api/src/metrics/metrics.service.ts` (`newCardsCount`, new private helper)
- Test: `apps/api/src/metrics/metrics.service.spec.ts`

**Interfaces:**
- Consumes: the Task 2 startable rule.
- Produces: `private startablePlannedIds(userId: string, domain?: string): Promise<string[]>` — IDs of startable planned topics in creation order (`createdAt asc, id asc`). Task 4's `nextUp` reuses it. `newCardsCount(userId, domain?)` signature unchanged.

- [ ] **Step 1: Replace the stale scoping test with failing ones**

In `apps/api/src/metrics/metrics.service.spec.ts`, **replace** the test `'newCardsCount scopes to state new, non-suspended, through non-archived topics (including mastered)'` with:

```ts
it('newCardsCount includes startable planned topics and excludes blocked ones', async () => {
  prisma.topic.findMany.mockImplementation(({ where }: any) =>
    Promise.resolve(
      where?.status === 'planned'
        ? [
            { id: 'startable', prerequisites: [{ prerequisite: { status: 'active' } }] },
            { id: 'zero-prereq', prerequisites: [] },
            { id: 'blocked', prerequisites: [{ prerequisite: { status: 'planned' } }] },
          ]
        : [],
    ),
  );
  prisma.prompt.count.mockResolvedValue(3);
  const result = await service.newCardsCount('userA', 'DSA');
  expect(result).toBe(3);
  expect(prisma.prompt.count).toHaveBeenCalledWith({
    where: {
      suspended: false,
      state: 'new',
      topic: { userId: 'userA', domain: 'DSA' },
      OR: [
        { topic: { status: { in: ['active', 'mastered'] } } },
        { topicId: { in: ['startable', 'zero-prereq'] } },
      ],
    },
  });
});
it('newCardsCount queries planned topics in creation order scoped to the user', async () => {
  await service.newCardsCount('userA');
  expect(prisma.topic.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { userId: 'userA', status: 'planned' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
  );
});
```

Note the mock style: `prisma.topic.findMany` becomes a `mockImplementation` keyed on `where.status`, because `newCardsCount` now issues its own `topic.findMany` for planned topics while `dueTopics` still issues one for active topics.

- [ ] **Step 2: Run to verify failure**

Run: `yarn workspace @terrain/api test metrics.service`
Expected: FAIL — `prompt.count` called with the old `{status: {not: 'archived'}}` shape.

- [ ] **Step 3: Implement**

In `apps/api/src/metrics/metrics.service.ts`, add the helper and rewrite `newCardsCount`:

```ts
/**
 * IDs of planned topics whose direct prerequisites are all started
 * (active or mastered) — the startable frontier, in creation order.
 */
private async startablePlannedIds(userId: string, domain?: string): Promise<string[]> {
  const planned = await this.prisma.topic.findMany({
    where: { userId, status: 'planned', ...(domain ? { domain } : {}) },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      prerequisites: { select: { prerequisite: { select: { status: true } } } },
    },
  });
  return planned
    .filter((t) =>
      t.prerequisites.every(
        (p) => p.prerequisite.status === 'active' || p.prerequisite.status === 'mastered',
      ),
    )
    .map((t) => t.id);
}

/**
 * Non-suspended `new`-state cards whose topic is studyable today: active or
 * mastered, or a startable planned topic. Blocked planned topics' starter
 * cards are excluded — they'd inflate "New: N" with cards you can't reach.
 */
async newCardsCount(userId: string, domain?: string): Promise<number> {
  const startableIds = await this.startablePlannedIds(userId, domain);
  return this.prisma.prompt.count({
    where: {
      suspended: false,
      state: 'new',
      topic: { userId, ...(domain ? { domain } : {}) },
      OR: [
        { topic: { status: { in: ['active', 'mastered'] } } },
        { topicId: { in: startableIds } },
      ],
    },
  });
}
```

- [ ] **Step 4: Fix the existing dashboard test's mock, run suite**

The test `'dashboard composes counts from groupBy and due lengths, and includes newCards'` mocks `prisma.topic.findMany` with a single `mockResolvedValue` of due rows — `startablePlannedIds` would now receive rows without `prerequisites` and crash. Change that test's arrangement to:

```ts
prisma.topic.findMany.mockImplementation(({ where }: any) =>
  Promise.resolve(
    where?.status === 'planned'
      ? []
      : [
          { nextReviewAt: new Date('2026-01-05T00:00:00Z') }, // overdue in every timezone
          { nextReviewAt: now }, // >= startOfToday in every timezone => dueToday
        ],
  ),
);
```
(`const now` already exists in the test; move its declaration above the mock.)

Run: `yarn workspace @terrain/api test`
Expected: all green. `yarn lint && yarn format:check` clean. Leave in working tree.

---

### Task 4: `nextUp` selection on the dashboard payload (API)

**Files:**
- Modify: `apps/api/src/metrics/metrics.service.ts` (new `NextUp` interface, `nextUp()`, `dashboard()`)
- Test: `apps/api/src/metrics/metrics.service.spec.ts`

**Interfaces:**
- Consumes: `startablePlannedIds` from Task 3.
- Produces:
  ```ts
  export interface NextUp {
    topic: Topic; // @prisma/client Topic row
    chapterTitle: string | null;
    chapterProgress: { started: number; total: number } | null;
  }
  // MetricsService.nextUp(userId: string, domain?: string): Promise<NextUp | null>
  // dashboard() payload gains: nextUp: NextUp | null
  ```
  Task 5 mirrors this shape in web types.

- [ ] **Step 1: Write failing tests**

Append to `apps/api/src/metrics/metrics.service.spec.ts` (also add `findFirst: jest.fn()` to the `prisma.topic` mock object in `beforeEach`):

```ts
describe('nextUp', () => {
  it('returns the first startable planned topic in creation order, skipping blocked ones', async () => {
    prisma.topic.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve(
        where?.status === 'planned'
          ? [
              { id: 't-blocked', prerequisites: [{ prerequisite: { status: 'planned' } }] },
              { id: 't-startable', prerequisites: [{ prerequisite: { status: 'active' } }] },
            ]
          : [],
      ),
    );
    prisma.topic.findFirst.mockResolvedValue({ id: 't-startable', title: 'Stack', parentId: null });
    const result = await service.nextUp('userA');
    expect(result).toEqual({
      topic: { id: 't-startable', title: 'Stack', parentId: null },
      chapterTitle: null,
      chapterProgress: null,
    });
    // ordering is delegated to SQL — assert it, and that aiProposed is NOT filtered
    expect(prisma.topic.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'userA', status: 'planned' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    );
  });

  it('attaches chapter title and started/total progress when the topic has a parent', async () => {
    prisma.topic.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve(where?.status === 'planned' ? [{ id: 't1', prerequisites: [] }] : []),
    );
    prisma.topic.findFirst
      .mockResolvedValueOnce({ id: 't1', title: 'Two Sum', parentId: 'chapter-1' })
      .mockResolvedValueOnce({
        title: 'Arrays & Hashing',
        children: [{ status: 'active' }, { status: 'mastered' }, { status: 'planned' }],
      });
    const result = await service.nextUp('userA');
    expect(result?.chapterTitle).toBe('Arrays & Hashing');
    expect(result?.chapterProgress).toEqual({ started: 2, total: 3 });
  });

  it('returns null when every planned topic is blocked', async () => {
    prisma.topic.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve(
        where?.status === 'planned'
          ? [{ id: 't1', prerequisites: [{ prerequisite: { status: 'planned' } }] }]
          : [],
      ),
    );
    expect(await service.nextUp('userA')).toBeNull();
    expect(prisma.topic.findFirst).not.toHaveBeenCalled();
  });

  it('returns null when no planned topics exist', async () => {
    prisma.topic.findMany.mockResolvedValue([]);
    expect(await service.nextUp('userA')).toBeNull();
  });

  it('scopes the candidate query by domain', async () => {
    prisma.topic.findMany.mockResolvedValue([]);
    await service.nextUp('userA', 'DSA');
    expect(prisma.topic.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'userA', status: 'planned', domain: 'DSA' } }),
    );
  });
});

it('dashboard includes nextUp (null when nothing is startable)', async () => {
  prisma.topic.findMany.mockImplementation(({ where }: any) =>
    Promise.resolve(where?.status === 'planned' ? [] : []),
  );
  const result = await service.dashboard('userA', new Date('2026-01-08T12:00:00Z'));
  expect(result.nextUp).toBeNull();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn workspace @terrain/api test metrics.service`
Expected: FAIL with `service.nextUp is not a function`.

- [ ] **Step 3: Implement**

In `apps/api/src/metrics/metrics.service.ts`, add above the class:

```ts
export interface NextUp {
  topic: Topic;
  chapterTitle: string | null;
  chapterProgress: { started: number; total: number } | null;
}
```

(`Topic` is already imported from `@prisma/client`.) Add the method:

```ts
/**
 * The single guided suggestion: first startable planned topic in creation
 * order (preserves authored curriculum order). Tentative (aiProposed)
 * topics are candidates — starting one commits it (web-side).
 */
async nextUp(userId: string, domain?: string): Promise<NextUp | null> {
  const [firstId] = await this.startablePlannedIds(userId, domain);
  if (!firstId) return null;
  const topic = await this.prisma.topic.findFirst({ where: { id: firstId, userId } });
  if (!topic) return null;
  if (!topic.parentId) return { topic, chapterTitle: null, chapterProgress: null };
  const parent = await this.prisma.topic.findFirst({
    where: { id: topic.parentId, userId },
    select: { title: true, children: { select: { status: true } } },
  });
  if (!parent) return { topic, chapterTitle: null, chapterProgress: null };
  const started = parent.children.filter(
    (c) => c.status === 'active' || c.status === 'mastered',
  ).length;
  return {
    topic,
    chapterTitle: parent.title,
    chapterProgress: { started, total: parent.children.length },
  };
}
```

In `dashboard()`, extend the `Promise.all` and payload:

```ts
const [struggleRatio7d, due, grouped, newCards, nextUp] = await Promise.all([
  this.struggleRatio7d(userId, now),
  this.dueTopics(userId, now, domain),
  this.prisma.topic.groupBy({
    by: ['status'],
    _count: true,
    where: { userId, ...(domain ? { domain } : {}) },
  }),
  this.newCardsCount(userId, domain),
  this.nextUp(userId, domain),
]);
```
and add `nextUp,` to the returned object (after `newCards`).

- [ ] **Step 4: Run the full suite + build**

Run: `yarn workspace @terrain/api test && yarn workspace @terrain/api build`
Expected: all green, 0 build errors. `yarn lint && yarn format:check` clean. Leave in working tree.

---

### Task 5: "Next up" hero card on the Dashboard (web)

**Files:**
- Modify: `apps/web/src/api/types.ts` (add `NextUp`, extend `Dashboard`)
- Create: `apps/web/src/screens/Dashboard/NextUpCard.tsx`
- Modify: `apps/web/src/screens/Dashboard/index.tsx`

**Interfaces:**
- Consumes: `Dashboard.nextUp` from Task 4 (via existing `useDashboard()`); existing `useUpdateTopic`, `Card`, `Modal`+`ReviewGate` machinery already in the Dashboard.
- Produces: `NextUpCard({ nextUp, plannedCount, starting, onStart }): JSX | null` and the web `NextUp` type — Task 8's Roadmap reads `useDashboard().data?.nextUp?.topic.id`.

- [ ] **Step 1: Extend the API mirror types**

In `apps/web/src/api/types.ts`, after the `StreakState` interface, add:

```ts
export interface NextUp {
  topic: Topic;
  chapterTitle: string | null;
  chapterProgress: { started: number; total: number } | null;
}
```

and inside `interface Dashboard`, after `newCards: number;`, add:

```ts
nextUp: NextUp | null;
```

- [ ] **Step 2: Create the card component**

Create `apps/web/src/screens/Dashboard/NextUpCard.tsx`:

```tsx
import type { NextUp, Topic } from '../../api/types';
import { Card } from '../../components';

/**
 * The guided "what now" surface: exactly one suggested topic (server-picked,
 * curriculum order) with a one-click Start. Renders a blocked explainer when
 * planned topics remain but none is startable, and nothing at all when the
 * curriculum is exhausted.
 */
export default function NextUpCard({
  nextUp,
  plannedCount,
  starting,
  onStart,
}: {
  nextUp: NextUp | null;
  plannedCount: number;
  starting: boolean;
  onStart: (topic: Topic) => void;
}) {
  if (!nextUp && plannedCount === 0) return null;

  return (
    <div style={{ marginBottom: 18 }}>
      <Card title="Next up">
        {!nextUp ? (
          <p className="muted" style={{ margin: 0 }}>
            All remaining topics are blocked — keep reviewing to unlock them.
          </p>
        ) : (
          <NextUpBody nextUp={nextUp} starting={starting} onStart={onStart} />
        )}
      </Card>
    </div>
  );
}

function NextUpBody({
  nextUp: { topic, chapterTitle, chapterProgress },
  starting,
  onStart,
}: {
  nextUp: NextUp;
  starting: boolean;
  onStart: (topic: Topic) => void;
}) {
  const snippet =
    topic.description && topic.description.length > 220
      ? `${topic.description.slice(0, 220)}…`
      : topic.description;
  return (
    <div className="col gap-2">
      {chapterTitle && (
        <div className="faint" style={{ fontSize: 12.5 }}>
          {chapterTitle}
          {chapterProgress && ` · ${chapterProgress.started} of ${chapterProgress.total} started`}
        </div>
      )}
      <div className="row gap-2" style={{ alignItems: 'center' }}>
        <span style={{ fontWeight: 650, fontSize: 16 }}>{topic.title}</span>
        <span className="pill">{topic.topicType}</span>
        {topic.aiProposed && (
          <span title="Imported from Claude" style={{ color: 'var(--st-active)' }}>
            ✦
          </span>
        )}
      </div>
      {snippet && (
        <p className="muted" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5 }}>
          {snippet}
        </p>
      )}
      <div>
        <button className="btn btn-primary" disabled={starting} onClick={() => onStart(topic)}>
          {starting ? 'Starting…' : 'Start'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire it into the Dashboard**

In `apps/web/src/screens/Dashboard/index.tsx`:

1. Add imports:
```tsx
import { useDashboard, useHeatmap, useSkipStreak, useStreak, useUpdateTopic } from '../../api/hooks';
import NextUpCard from './NextUpCard';
```
2. Inside the component, after `const [logTopic, setLogTopic] = useState<Topic | null>(null);`:
```tsx
const { mutate: updateTopic, isPending: starting } = useUpdateTopic();
```
3. After the `useFreeze` function, add the Start verb (activate + commit, then open the existing review modal — the first review materializes `nextReviewAt`):
```tsx
function startTopic(topic: Topic) {
  updateTopic(
    { id: topic.id, input: { status: 'active', aiProposed: false } },
    {
      onSuccess: () => setLogTopic({ ...topic, status: 'active' }),
      onError: (e) => toast(e instanceof Error ? e.message : 'Could not start topic', 'error'),
    },
  );
}
```
4. Between the KPI row's closing `</div>` and the `{/* ---- struggle + library ---- */}` comment, render:
```tsx
{/* ---- next up ---- */}
<NextUpCard
  nextUp={dash.nextUp}
  plannedCount={counts.planned}
  starting={starting}
  onStart={startTopic}
/>
```

- [ ] **Step 4: Build + live check**

Run: `yarn workspace @terrain/web build`
Expected: 0 errors (tsc + vite). With the stack running (`docker compose up -d`, API on :3000, `yarn workspace @terrain/web dev`), log in at `http://localhost:5180`, confirm: the card shows the first startable DSA topic with chapter context; clicking **Start** opens the Recall modal on its first card; grading it advances the card to a new suggestion; the "New: N" pill dropped versus before (blocked topics' cards no longer counted). `yarn lint && yarn format:check` clean. Leave in working tree.

---

### Task 6: `projectRoadmap` — the drill-down projection module (web, vitest)

The one genuinely intricate piece of Phase 2, kept as a pure function so it's unit-testable. This task adds vitest to `apps/web` (first web unit tests; pure logic only, no DOM).

**Files:**
- Modify: `apps/web/package.json` (add `vitest` devDependency + `test` script)
- Create: `apps/web/src/screens/Roadmap/projection.ts`
- Test: `apps/web/src/screens/Roadmap/projection.test.ts`

**Interfaces:**
- Consumes: `TopicWithMeta` from `../../api/types` (with Task 2's `labels.blocked` semantics).
- Produces (Task 7/8 build UI directly on these):
  ```ts
  export type RoadmapItem =
    | { kind: 'leaf'; topic: TopicWithMeta; isNextUp: boolean }
    | { kind: 'group'; topic: TopicWithMeta;
        progress: { started: number; total: number };
        startableCount: number; tentativeCount: number; containsNextUp: boolean }
    | { kind: 'ghost'; topic: TopicWithMeta; chapterTitle: string | null };
  export interface RoadmapEdge {
    id: string; source: string; target: string;
    kind: 'prereq' | 'aggregated' | 'ghost';
  }
  export interface Projection {
    items: RoadmapItem[]; edges: RoadmapEdge[];
    breadcrumb: { id: string; title: string }[];
    effectiveFocusId: string | null;
  }
  export function projectRoadmap(input: {
    topics: TopicWithMeta[]; focusId: string | null; domain: string;
    showParked: boolean; nextUpId: string | null;
  }): Projection
  ```

- [ ] **Step 1: Add vitest to the web workspace**

In `apps/web/package.json`, add to `scripts`:
```json
"test": "vitest run"
```
and to `devDependencies` (same major as `packages/types`):
```json
"vitest": "^4"
```
Run: `yarn install`
Expected: resolves cleanly. (Root `yarn test` runs every workspace's `test` script, so web tests join the suite automatically.)

- [ ] **Step 2: Write the failing tests**

Create `apps/web/src/screens/Roadmap/projection.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { TopicWithMeta } from '../../api/types';
import { projectRoadmap } from './projection';

function topic(over: Partial<TopicWithMeta> & { id: string; title: string }): TopicWithMeta {
  return {
    domain: 'DSA',
    topicType: 'concept',
    status: 'planned',
    description: null,
    summary: null,
    noteRef: null,
    parentId: null,
    nextReviewAt: null,
    learnedAt: null,
    aiProposed: false,
    aiContext: null,
    createdAt: '2026-07-02T00:00:00Z',
    updatedAt: '2026-07-02T00:00:00Z',
    prerequisiteIds: [],
    labels: { blocked: false, reviewing: false },
    ...over,
  };
}

// R (root) ── A (chapter: a1 active, a2 planned) ── B (chapter: b1 blocked, needs a2)
const R = topic({ id: 'R', title: 'DSA Root' });
const A = topic({ id: 'A', title: 'Arrays', parentId: 'R' });
const B = topic({ id: 'B', title: 'Stack', parentId: 'R' });
const a1 = topic({ id: 'a1', title: 'Prefix sums', parentId: 'A', status: 'active' });
const a2 = topic({ id: 'a2', title: 'Two Sum', parentId: 'A', prerequisiteIds: ['a1'] });
const b1 = topic({
  id: 'b1',
  title: 'Monotonic stack',
  parentId: 'B',
  prerequisiteIds: ['a2'],
  labels: { blocked: true, reviewing: false },
});
const TOPICS = [R, A, B, a1, a2, b1];

const project = (over: Partial<Parameters<typeof projectRoadmap>[0]> = {}) =>
  projectRoadmap({
    topics: TOPICS,
    focusId: null,
    domain: '__all__',
    showParked: false,
    nextUpId: null,
    ...over,
  });

describe('projectRoadmap', () => {
  it('auto-drills through a single-group root level', () => {
    const p = project();
    expect(p.effectiveFocusId).toBe('R');
    expect(p.breadcrumb).toEqual([{ id: 'R', title: 'DSA Root' }]);
    expect(p.items.map((i) => [i.kind, i.topic.id]).sort()).toEqual([
      ['group', 'A'],
      ['group', 'B'],
    ]);
  });

  it('computes group counts over the whole subtree, including the chapter itself', () => {
    const p = project();
    const groupA = p.items.find((i) => i.topic.id === 'A');
    if (groupA?.kind !== 'group') throw new Error('A must be a group');
    expect(groupA.progress).toEqual({ started: 1, total: 3 }); // a1 active of {A, a1, a2}
    expect(groupA.startableCount).toBe(2); // A itself + a2 (planned, not blocked)
    const groupB = p.items.find((i) => i.topic.id === 'B');
    if (groupB?.kind !== 'group') throw new Error('B must be a group');
    expect(groupB.startableCount).toBe(1); // B itself; b1 is blocked
  });

  it('aggregates cross-subtree prerequisite edges to one group-level edge', () => {
    const p = project();
    expect(p.edges).toEqual([{ id: 'A->B', source: 'A', target: 'B', kind: 'aggregated' }]);
  });

  it('drilling into a chapter yields leaves with direct (deletable) prereq edges', () => {
    const p = project({ focusId: 'A' });
    expect(p.effectiveFocusId).toBe('A');
    expect(p.breadcrumb.map((c) => c.id)).toEqual(['R', 'A']);
    expect(p.items.map((i) => [i.kind, i.topic.id]).sort()).toEqual([
      ['leaf', 'a1'],
      ['leaf', 'a2'],
    ]);
    expect(p.edges).toEqual([{ id: 'a1->a2', source: 'a1', target: 'a2', kind: 'prereq' }]);
  });

  it('renders external prerequisites of visible leaves as ghosts with chapter labels', () => {
    const p = project({ focusId: 'B' });
    const ghost = p.items.find((i) => i.kind === 'ghost');
    expect(ghost?.topic.id).toBe('a2');
    expect(ghost?.kind === 'ghost' && ghost.chapterTitle).toBe('Arrays');
    expect(p.edges).toEqual([
      { id: 'ghost-a2->b1', source: 'a2', target: 'b1', kind: 'ghost' },
    ]);
  });

  it('flags the next-up leaf and its containing groups', () => {
    const root = project({ nextUpId: 'a2' });
    const groupA = root.items.find((i) => i.topic.id === 'A');
    const groupB = root.items.find((i) => i.topic.id === 'B');
    expect(groupA?.kind === 'group' && groupA.containsNextUp).toBe(true);
    expect(groupB?.kind === 'group' && groupB.containsNextUp).toBe(false);
    const drilled = project({ focusId: 'A', nextUpId: 'a2' });
    const leaf = drilled.items.find((i) => i.topic.id === 'a2');
    expect(leaf?.kind === 'leaf' && leaf.isNextUp).toBe(true);
  });

  it('hides parked topics unless the shelf is on, then shows them at their level', () => {
    const parked = topic({
      id: 'p1',
      title: 'Parked idea',
      parentId: 'B',
      aiProposed: true,
      status: 'archived',
    });
    const topics = [...TOPICS, parked];
    const off = projectRoadmap({
      topics, focusId: 'B', domain: '__all__', showParked: false, nextUpId: null,
    });
    expect(off.items.some((i) => i.topic.id === 'p1')).toBe(false);
    const on = projectRoadmap({
      topics, focusId: 'B', domain: '__all__', showParked: true, nextUpId: null,
    });
    expect(on.items.some((i) => i.kind === 'leaf' && i.topic.id === 'p1')).toBe(true);
  });

  it('filters by domain and falls back to root when the focus is filtered out', () => {
    const other = topic({ id: 'x1', title: 'Other domain', domain: 'Systems' });
    const p = projectRoadmap({
      topics: [...TOPICS, other], focusId: 'x-gone', domain: 'Systems',
      showParked: false, nextUpId: null,
    });
    expect(p.effectiveFocusId).toBeNull();
    expect(p.items).toEqual([{ kind: 'leaf', topic: other, isNextUp: false }]);
    expect(p.breadcrumb).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `yarn workspace @terrain/web test`
Expected: FAIL — cannot resolve `./projection`.

- [ ] **Step 4: Implement the module**

Create `apps/web/src/screens/Roadmap/projection.ts`:

```ts
import type { TopicWithMeta } from '../../api/types';

export type RoadmapItem =
  | { kind: 'leaf'; topic: TopicWithMeta; isNextUp: boolean }
  | {
      kind: 'group';
      topic: TopicWithMeta;
      progress: { started: number; total: number };
      startableCount: number;
      tentativeCount: number;
      containsNextUp: boolean;
    }
  | { kind: 'ghost'; topic: TopicWithMeta; chapterTitle: string | null };

export interface RoadmapEdge {
  id: string;
  source: string;
  target: string;
  kind: 'prereq' | 'aggregated' | 'ghost';
}

export interface Projection {
  items: RoadmapItem[];
  edges: RoadmapEdge[];
  /** Root-first path of real topics from the top level down to the effective focus. */
  breadcrumb: { id: string; title: string }[];
  /** Focus after validation + auto-drill — what the breadcrumb highlights. */
  effectiveFocusId: string | null;
}

const isStarted = (s: TopicWithMeta['status']) => s === 'active' || s === 'mastered';

/**
 * Projects the flat topic list onto one drill-down level of the Roadmap:
 * the children of `focusId` (roots when null), where a child with children
 * renders as a collapsed group. Prerequisite edges are lifted to their
 * visible subtree owners; a visible leaf's prerequisite outside the level
 * becomes a ghost node. Parent edges don't exist here by construction —
 * containment IS the parent structure.
 */
export function projectRoadmap(input: {
  topics: TopicWithMeta[];
  focusId: string | null;
  domain: string; // '__all__' or one domain
  showParked: boolean;
  nextUpId: string | null;
}): Projection {
  const { topics, domain, showParked, nextUpId } = input;

  // Same visibility rule the flat graph used: active graph + parked-when-toggled.
  const pool = topics.filter((t) => {
    if (domain !== '__all__' && t.domain !== domain) return false;
    const parked = t.aiProposed && t.status === 'archived';
    if (t.status === 'archived') return parked && showParked;
    return true;
  });
  const byId = new Map(pool.map((t) => [t.id, t]));
  const childrenOf = new Map<string | null, TopicWithMeta[]>();
  for (const t of pool) {
    const parent = t.parentId != null && byId.has(t.parentId) ? t.parentId : null;
    const list = childrenOf.get(parent) ?? [];
    list.push(t);
    childrenOf.set(parent, list);
  }
  const hasChildren = (id: string) => (childrenOf.get(id) ?? []).length > 0;

  // Validate the focus, then auto-drill while a level is exactly one group.
  let focus = input.focusId != null && byId.has(input.focusId) ? input.focusId : null;
  for (;;) {
    const level = childrenOf.get(focus) ?? [];
    if (level.length === 1 && hasChildren(level[0].id)) {
      focus = level[0].id;
      continue;
    }
    break;
  }
  const level = childrenOf.get(focus) ?? [];

  // Subtree (self + descendants) per visible node; owner lookup for edge lifting.
  const ownerOf = new Map<string, string>();
  const subtrees = new Map<string, TopicWithMeta[]>();
  for (const v of level) {
    const acc: TopicWithMeta[] = [];
    const stack = [v];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      acc.push(cur);
      ownerOf.set(cur.id, v.id);
      for (const c of childrenOf.get(cur.id) ?? []) stack.push(c);
    }
    subtrees.set(v.id, acc);
  }

  const isStartable = (t: TopicWithMeta) => t.status === 'planned' && !t.labels.blocked;
  const isTentative = (t: TopicWithMeta) => t.aiProposed && t.status !== 'archived';

  const items: RoadmapItem[] = level.map((t) => {
    if (!hasChildren(t.id)) return { kind: 'leaf', topic: t, isNextUp: t.id === nextUpId };
    const sub = subtrees.get(t.id)!;
    return {
      kind: 'group',
      topic: t,
      progress: { started: sub.filter((s) => isStarted(s.status)).length, total: sub.length },
      startableCount: sub.filter(isStartable).length,
      tentativeCount: sub.filter(isTentative).length,
      containsNextUp: nextUpId != null && sub.some((s) => s.id === nextUpId),
    };
  });

  // Lift prereq edges to visible owners; externals of visible leaves → ghosts.
  const edges: RoadmapEdge[] = [];
  const seen = new Set<string>();
  const ghosts = new Map<string, TopicWithMeta>();
  const titleById = new Map(topics.map((t) => [t.id, t.title]));
  for (const t of pool) {
    const to = ownerOf.get(t.id);
    for (const preId of t.prerequisiteIds) {
      if (!byId.has(preId)) continue;
      const from = ownerOf.get(preId);
      if (from != null && to != null && from !== to) {
        const id = `${from}->${to}`;
        if (seen.has(id)) continue;
        seen.add(id);
        // Deletable only when it IS the underlying edge: both endpoints visible leaves.
        const direct =
          from === preId && to === t.id && !hasChildren(from) && !hasChildren(to);
        edges.push({ id, source: from, target: to, kind: direct ? 'prereq' : 'aggregated' });
      } else if (from == null && to === t.id && !hasChildren(t.id)) {
        ghosts.set(preId, byId.get(preId)!);
        const id = `ghost-${preId}->${t.id}`;
        if (!seen.has(id)) {
          seen.add(id);
          edges.push({ id, source: preId, target: t.id, kind: 'ghost' });
        }
      }
    }
  }
  for (const g of ghosts.values()) {
    items.push({
      kind: 'ghost',
      topic: g,
      chapterTitle: g.parentId != null ? (titleById.get(g.parentId) ?? null) : null,
    });
  }

  // Breadcrumb: walk up from the effective focus over the FULL topic list.
  const allById = new Map(topics.map((t) => [t.id, t]));
  const breadcrumb: { id: string; title: string }[] = [];
  let cursor = focus;
  const visited = new Set<string>();
  while (cursor != null && !visited.has(cursor)) {
    visited.add(cursor);
    const t = allById.get(cursor);
    if (!t) break;
    breadcrumb.unshift({ id: t.id, title: t.title });
    cursor = t.parentId;
  }

  return { items, edges, breadcrumb, effectiveFocusId: focus };
}
```

- [ ] **Step 5: Run tests**

Run: `yarn workspace @terrain/web test`
Expected: all 8 tests PASS. Also run `yarn workspace @terrain/web build` (test file must typecheck under `tsc --noEmit`). `yarn lint && yarn format:check` clean. Leave in working tree.

---

### Task 7: GroupNode, GhostNode, and TopicNode dim/ring (web)

**Files:**
- Create: `apps/web/src/screens/Roadmap/GroupNode.tsx`
- Create: `apps/web/src/screens/Roadmap/GhostNode.tsx`
- Modify: `apps/web/src/screens/Roadmap/TopicNode.tsx`

**Interfaces:**
- Consumes: `RoadmapItem` field shapes from Task 6.
- Produces (Task 8 registers these as React Flow node types):
  ```ts
  // GroupNode.tsx
  export type GroupNodeData = {
    topic: TopicWithMeta;
    progress: { started: number; total: number };
    startableCount: number; tentativeCount: number; containsNextUp: boolean;
  };
  export type GroupNodeType = Node<GroupNodeData, 'group'>;
  // GhostNode.tsx
  export type GhostNodeData = { topic: TopicWithMeta; chapterTitle: string | null };
  export type GhostNodeType = Node<GhostNodeData, 'ghost'>;
  // TopicNode.tsx — TopicNodeData gains: isNextUp?: boolean
  ```

- [ ] **Step 1: Create GroupNode**

Create `apps/web/src/screens/Roadmap/GroupNode.tsx`:

```tsx
import { Handle, Position } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import type { TopicWithMeta } from '../../api/types';

export type GroupNodeData = {
  topic: TopicWithMeta;
  progress: { started: number; total: number };
  startableCount: number;
  tentativeCount: number;
  containsNextUp: boolean;
};

export type GroupNodeType = Node<GroupNodeData, 'group'>;

/**
 * Collapsed chapter node: a topic with children, shown as its whole subtree.
 * Click drills in (handled by the screen). Handles exist so aggregated edges
 * can attach, but connections can't start or end here.
 */
export default function GroupNode({ data }: NodeProps<GroupNodeType>) {
  const { topic, progress, startableCount, tentativeCount, containsNextUp } = data;
  return (
    <div
      className="rf-node"
      title={`Open ${topic.title}`}
      style={{
        borderWidth: 2,
        cursor: 'pointer',
        boxShadow: containsNextUp ? '0 0 0 2px var(--st-active)' : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="rf-title" style={{ fontWeight: 650 }}>
        {topic.title}
      </div>
      <div className="rf-meta row wrap gap-1" style={{ alignItems: 'center' }}>
        <span>
          {progress.started}/{progress.total} started
        </span>
        {startableCount > 0 && <span className="pill">▶ {startableCount} startable</span>}
        {tentativeCount > 0 && (
          <span
            title="Contains imported, un-curated topics"
            style={{ color: 'var(--st-active)' }}
          >
            ✦ {tentativeCount}
          </span>
        )}
        {containsNextUp && <span className="pill">Next up</span>}
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}
```

- [ ] **Step 2: Create GhostNode**

Create `apps/web/src/screens/Roadmap/GhostNode.tsx`:

```tsx
import { Handle, Position } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import type { TopicWithMeta } from '../../api/types';

export type GhostNodeData = {
  topic: TopicWithMeta;
  chapterTitle: string | null;
};

export type GhostNodeType = Node<GhostNodeData, 'ghost'>;

/**
 * A dimmed stand-in for a visible leaf's prerequisite that lives outside the
 * current drill level. Click navigates to its chapter (handled by the screen).
 */
export default function GhostNode({ data }: NodeProps<GhostNodeType>) {
  const { topic, chapterTitle } = data;
  return (
    <div
      className="rf-node"
      title={chapterTitle ? `Go to ${chapterTitle}` : undefined}
      style={{ opacity: 0.45, borderStyle: 'dashed', cursor: 'pointer' }}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="rf-title">{topic.title}</div>
      <div className="rf-meta">{chapterTitle ? `in ${chapterTitle}` : 'elsewhere'}</div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}
```

- [ ] **Step 3: TopicNode — dim mastered/blocked, next-up ring**

In `apps/web/src/screens/Roadmap/TopicNode.tsx`:

1. Add `isNextUp?: boolean;` to `TopicNodeData` (after `selected: boolean;`).
2. In the component, destructure it: `const { topic, selected, isNextUp, onKeep, onSetAside, onRestore, onDelete } = data;`
3. Replace the `opacity: parked ? 0.55 : 1,` style line and add the ring, so the root `div`'s style becomes:

```tsx
style={{
  borderLeft: `4px solid ${color}`,
  border: tentative ? `1px dashed ${color}` : undefined,
  borderLeftWidth: 4,
  // Emphasis: startable/active pop; mastered and blocked recede.
  opacity: parked || blocked || topic.status === 'mastered' ? 0.55 : 1,
  boxShadow: isNextUp ? '0 0 0 2px var(--st-active)' : undefined,
}}
```

- [ ] **Step 4: Build**

Run: `yarn workspace @terrain/web build`
Expected: 0 errors (the new components are not yet imported anywhere — that's fine, they compile standalone; Rolldown tree-shakes). `yarn lint && yarn format:check` clean. Leave in working tree.

---

### Task 8: Rewire the Roadmap screen to the drill-down projection (web)

**Files:**
- Modify: `apps/web/src/screens/Roadmap/index.tsx`

**Interfaces:**
- Consumes: `projectRoadmap`/`Projection` (Task 6), `GroupNode`/`GhostNode`/`TopicNode` types (Task 7), `useDashboard().data?.nextUp` (Tasks 4–5).
- Produces: the final Phase 2 UI. No downstream consumers.

- [ ] **Step 1: Rework state, imports, and node types**

In `apps/web/src/screens/Roadmap/index.tsx`:

1. Extend imports:
```tsx
import {
  useDashboard,
  useTopics,
  useUpdateTopic,
  useDeleteTopic,
  useAddPrerequisite,
  useRemovePrerequisite,
} from '../../api/hooks';
import GroupNode, { type GroupNodeType } from './GroupNode';
import GhostNode, { type GhostNodeData, type GhostNodeType } from './GhostNode';
import { projectRoadmap } from './projection';
```
2. Replace the `nodeTypes` constant:
```tsx
type RoadmapNode = TopicNodeType | GroupNodeType | GhostNodeType;
const nodeTypes = { topic: TopicNode, group: GroupNode, ghost: GhostNode } as NodeTypes;
```
3. Add screen state + next-up id inside the component (after `showParked`):
```tsx
const [focusId, setFocusId] = useState<string | null>(null);
const nextUpId = useDashboard().data?.nextUp?.topic.id ?? null;
```
4. Update the `rf` ref type: `useRef<ReactFlowInstance<RoadmapNode, Edge> | null>(null)`.

- [ ] **Step 2: Replace the derived-graph memo**

Replace the whole `const { derivedNodes, derivedEdges } = useMemo(...)` block (currently the domain-filter + edge-building code) with:

```tsx
const { derivedNodes, derivedEdges, breadcrumb, effectiveFocusId } = useMemo(() => {
  const projection = projectRoadmap({
    topics: topics ?? [],
    focusId,
    domain,
    showParked,
    nextUpId,
  });

  const baseNodes: RoadmapNode[] = projection.items.map((item) => {
    if (item.kind === 'group') {
      return {
        id: item.topic.id,
        type: 'group' as const,
        position: { x: 0, y: 0 },
        data: {
          topic: item.topic,
          progress: item.progress,
          startableCount: item.startableCount,
          tentativeCount: item.tentativeCount,
          containsNextUp: item.containsNextUp,
        },
      };
    }
    if (item.kind === 'ghost') {
      return {
        id: item.topic.id,
        type: 'ghost' as const,
        position: { x: 0, y: 0 },
        draggable: false,
        data: { topic: item.topic, chapterTitle: item.chapterTitle },
      };
    }
    return {
      id: item.topic.id,
      type: 'topic' as const,
      position: { x: 0, y: 0 },
      data: {
        topic: item.topic,
        selected: item.topic.id === selectedId,
        isNextUp: item.isNextUp,
        onKeep: keep,
        onSetAside: setAside,
        onRestore: restore,
        onDelete: removePermanently,
      } satisfies TopicNodeData,
    };
  });

  const builtEdges: Edge[] = projection.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    data: { kind: e.kind },
    selectable: e.kind === 'prereq',
    deletable: e.kind === 'prereq',
    style:
      e.kind === 'ghost'
        ? { strokeDasharray: '4 4', opacity: 0.5 }
        : e.kind === 'aggregated'
          ? { strokeWidth: 2 }
          : undefined,
    markerEnd: { type: MarkerType.ArrowClosed },
  }));

  // layoutGraph's generic can't carry the node-type union; restore it after.
  const laidOut = layoutGraph(
    baseNodes as unknown as Parameters<typeof layoutGraph>[0],
    builtEdges,
  ) as unknown as RoadmapNode[];
  return {
    derivedNodes: laidOut,
    derivedEdges: builtEdges,
    breadcrumb: projection.breadcrumb,
    effectiveFocusId: projection.effectiveFocusId,
  };
}, [topics, domain, selectedId, showParked, focusId, nextUpId, keep, setAside, restore, removePermanently]);
```

Also update the two `useNodesState`/`useEdgesState` generics from `TopicNodeType` to `RoadmapNode` (the seeding `useEffect` and `resyncFromDerived` stay as they are).

- [ ] **Step 3: Rework the interaction handlers**

Replace `onNodeClick` and `onNodeDragStop`:

```tsx
const onNodeClick: NodeMouseHandler<RoadmapNode> = (_e, node) => {
  if (node.type === 'group') {
    setSelectedId(null);
    setFocusId(node.id);
  } else if (node.type === 'ghost') {
    // Navigate to the ghost's chapter with it selected.
    setFocusId((node.data as GhostNodeData).topic.parentId ?? null);
    setSelectedId(node.id);
  } else {
    setSelectedId(node.id);
  }
};

const onNodeDragStop: OnNodeDrag<RoadmapNode> = (_e, node) => {
  const inst = rf.current;
  if (!inst || node.type === 'ghost') return;
  const hits = inst
    .getIntersectingNodes(node)
    .filter((n) => n.id !== node.id && n.type !== 'ghost');
  // Empty canvas or ambiguous drop → snap back. (Un-parenting moved to the
  // drawer: a canvas drop inside a drill level would teleport the node away.)
  if (hits.length !== 1) {
    resyncFromDerived();
    return;
  }
  const target = hits[0] as RoadmapNode;
  const topic = node.data.topic;
  if (target.id === (topic.parentId ?? null)) return; // no structural change
  updateTopic(
    { id: node.id, input: { parentId: target.id } },
    {
      onSuccess: () => toast(`Moved ${topic.title} into ${target.data.topic.title}`, 'success'),
      onError: (e) => {
        err(e, 'Move rejected');
        resyncFromDerived();
      },
    },
  );
};
```

`onConnect` and `onEdgesDelete` stay unchanged — group/ghost handles are `isConnectable={false}`, and only `kind: 'prereq'` edges are selectable/deletable.

- [ ] **Step 4: Breadcrumb UI + focus resets**

1. In the domain segmented control, reset focus on switch — both buttons' onClick become:
```tsx
onClick={() => { setDomain('__all__'); setFocusId(null); }}
// and for each domain d:
onClick={() => { setDomain(d); setFocusId(null); }}
```
2. Directly under the legend row (before the `{!hasTopics ? ...}` block), add:
```tsx
<div className="row wrap gap-1" style={{ alignItems: 'center', marginTop: 8 }}>
  <button
    className={'btn btn-sm' + (effectiveFocusId == null ? ' btn-primary' : '')}
    onClick={() => setFocusId(null)}
  >
    All
  </button>
  {breadcrumb.map((c) => (
    <span key={c.id} className="row gap-1" style={{ alignItems: 'center' }}>
      <span className="faint">›</span>
      <button
        className={'btn btn-sm' + (c.id === effectiveFocusId ? ' btn-primary' : '')}
        onClick={() => setFocusId(c.id)}
      >
        {c.title}
      </button>
    </span>
  ))}
</div>
```
3. Update the empty-projection branch hint (a drilled level can be empty):
```tsx
<EmptyState
  title="Nothing at this level"
  hint="Pick a different domain filter, or navigate up via the breadcrumb."
/>
```
4. In the `LEGEND` array, append a chapter hint entry:
```tsx
{ glyph: '▣', label: 'Chapter — click to open', color: 'var(--text-muted)' },
```

- [ ] **Step 5: Build + interactive verification**

Run: `yarn workspace @terrain/web build`
Expected: 0 errors. With the stack live, on `http://localhost:5180/roadmap` verify each:
- Domain `DSA` (or All, if DSA root is the only parentless topic): first paint shows ~18 chapter groups, no 100-node hairball, and **no dashed parent edges anywhere**.
- Chapter faces show `n/m started`, `▶ N startable`, `✦ N`; the chapter containing the next-up topic has a ring + "Next up" pill.
- Click a chapter → its patterns as leaves; breadcrumb `All › Data Structures & Algorithms › <chapter>`; blocked/mastered leaves dimmed; sibling prereq edges present and deletable (select + Delete key); cross-chapter prereqs appear as dashed ghosts; clicking a ghost jumps to its chapter with it selected.
- Drag a leaf onto a sibling or a group → "Moved X into Y" toast and it relocates; drop on empty canvas → snaps back, no un-parent.
- Tentative leaves still show Keep/Set-aside on hover; Parked ideas toggle still works.

`yarn lint && yarn format:check` clean. Leave in working tree.

---

### Task 9: Full verification sweep + ledger

**Files:**
- Modify: `.superpowers/sdd/progress.md` (append entry)
- Modify: `CLAUDE.md` (jest test-count reference)

**Interfaces:**
- Consumes: everything above.
- Produces: verified working tree + ledger entry.

- [ ] **Step 1: Full automated gates**

```bash
yarn build && yarn test && yarn lint && yarn format:check
```
Expected: every workspace builds; api jest green (was 47 tests — now more; note the new total), sr-engine 7, types 4, web vitest 8; lint/format clean.

- [ ] **Step 2: Boot smoke**

```bash
docker compose up -d
kill -9 $(lsof -ti:3000) 2>/dev/null; yarn workspace @terrain/api start &   # :3000
yarn workspace @terrain/web dev &                                           # :5180
sleep 8 && node scripts/smoke.mjs
```
Expected: smoke exits 0 (no console errors on /, /topics, /roadmap, /export, /import).

- [ ] **Step 3: API-level next-up sanity check**

```bash
node -e "
const API='http://localhost:3000';
const {TERRAIN_EMAIL:email,TERRAIN_PASSWORD:password}=process.env;
let cookie='';
const api=async(p,i={})=>{const r=await fetch(API+p,{...i,headers:{'content-type':'application/json',cookie,...i.headers}});const c=r.headers.getSetCookie?.()[0];if(c)cookie=c.split(';')[0];return{status:r.status,body:await r.json().catch(()=>null)}};
(async()=>{
  await api('/auth/login',{method:'POST',body:JSON.stringify({email,password})});
  const d=await api('/metrics/dashboard');
  if(d.status!==200) throw new Error('dashboard '+d.status);
  console.log('nextUp:',d.body.nextUp?.topic?.title,'| chapter:',d.body.nextUp?.chapterTitle,'| newCards:',d.body.newCards);
  if(!d.body.nextUp) throw new Error('expected a non-null nextUp after cleanup');
})();
"
```
Expected: prints a real topic title (the earliest-created startable DSA topic) and a `newCards` value visibly smaller than the pre-change 300-ish (blocked topics excluded).

- [ ] **Step 4: Update docs + ledger, report**

1. In `CLAUDE.md`, update the `jest (47 tests)` reference to the new count from Step 1.
2. Append to `.superpowers/sdd/progress.md`: date, "Next Up + Roadmap drill-down: blocked predicate redefined to prereqs-started; newCards scoped to startable; nextUp on dashboard + NextUpCard/Start verb; Roadmap re-projected to chapter drill-down (projection.ts + Group/Ghost nodes, vitest added to web); DSA duplicate cleanup script run (7 twins merged, reviewed topics activated). Spec: docs/superpowers/specs/2026-07-02-terrain-next-up-and-roadmap-drilldown-design.md".
3. Remind the user the working tree holds (uncommitted): `scripts/cleanup-dsa-duplicates.mjs`, API metrics changes + spec tests, web types/NextUpCard/Dashboard, Roadmap projection + nodes + screen, `apps/web/package.json` (+ lockfile), CLAUDE.md, ledger, the spec, and this plan.
