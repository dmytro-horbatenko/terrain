# Learn-Export Chapter Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the full-domain roadmap dump in `mode=learn` exports with a scoped chapter-context section (siblings + prerequisite chapters), and script the existing (but dormant) `proposedTopics` mechanism into the learn session conduct so the model can propose related/deeper roadmap topics.

**Architecture:** Two independent backend edits (`export-generator.service.ts`'s `generateLearn()` gets a narrower query + a new `chapterContext()` renderer; `session-conduct.ts`'s `LEARN_CONDUCT` string gets new instructional text) plus one frontend edit (the review screen renders proposed-topic titles instead of just a count). No schema, API contract, or type changes — the `proposedTopics` → `import.service.ts` pipeline and `NewTopicPlan` type already carry everything needed.

**Tech Stack:** NestJS 11 (apps/api), Jest, React 19 + Vite (apps/web), TypeScript 6.

**Spec:** `docs/superpowers/specs/2026-07-04-learn-export-chapter-context-design.md`

## Global Constraints

- Monorepo is Yarn 4 workspaces; run tests via `yarn workspace @terrain/api test` / `yarn workspace @terrain/web build` from repo root — no `cd`.
- oxlint/oxfmt conventions: single quotes, trailing commas, no eslint/prettier. Run `yarn lint` before committing.
- No comments unless they explain a non-obvious WHY (per CLAUDE.md / this repo's house style) — do not add explanatory comments to the new code.
- Do not touch `full` or `domain:<x>` export modes, or `repeat` mode — only `generateLearn()` changes.
- No per-topic accept/reject UI — the review screen only gains a read-only list.
- No new Prisma migration — all fields used already exist on `Topic`/`NewTopicPlan`.
- Commit after each task; do not batch multiple tasks into one commit.

---

### Task 1: Chapter-context section replaces the full roadmap in learn exports

**Files:**
- Modify: `apps/api/src/sessions/export-generator.service.ts:131-205` (the `generateLearn` method), and add a new private method near `roadmap()` (currently `export-generator.service.ts:238-268`).
- Test: `apps/api/src/sessions/export-generator.service.spec.ts:704-797` (the `describe('mode=learn', ...)` block).

**Interfaces:**
- Consumes: existing private helpers `this.glyph(t: TopicWithPrereqs): string` and `this.reviewingTag(t: TopicWithPrereqs): string` (both already defined at `export-generator.service.ts:211-230`, unchanged).
- Produces: new private method `private chapterContext(chapterTitle: string, siblings: TopicWithPrereqs[], prereqChapters: TopicWithPrereqs[]): string` on `ExportGeneratorService`. Not consumed by any other task.

- [ ] **Step 1: Update the `mode=learn` test fixture and write the new/failing assertions**

Open `apps/api/src/sessions/export-generator.service.spec.ts`. Replace the whole `describe('mode=learn', ...)` block (lines 704-797) with:

```ts
  describe('mode=learn', () => {
    const NOW = new Date('2026-07-03T10:00:00Z');

    function focusTopic(overrides: Record<string, unknown> = {}) {
      return {
        id: 'focus-1',
        title: 'Prefix sums',
        topicType: 'pattern',
        domain: 'DSA',
        status: 'planned',
        description: 'Running cumulative totals for O(1) range queries.',
        aiContext: null,
        parentId: 'chap-1',
        parent: {
          id: 'chap-1',
          title: 'Arrays & Hashing',
          prerequisites: [],
        },
        prerequisites: [
          {
            prerequisite: {
              title: 'Hashing fundamentals',
              status: 'active',
              summary: '**Key insight:** buckets trade memory for time.',
            },
          },
          { prerequisite: { title: 'Arrays 101', status: 'mastered', summary: null } },
        ],
        prompts: [{ id: 'c1', promptKind: 'concept', promptText: 'Define a prefix-sum array.' }],
        ...overrides,
      };
    }

    it('renders learning goal, prereq summaries, existing cards, conduct, and chapter context siblings', async () => {
      prisma.user.findUnique = jest.fn().mockResolvedValue({ name: 'Dm' });
      prisma.topic.findFirst = jest.fn().mockResolvedValue(focusTopic());
      // chapter-context query returns the focus topic itself (must be excluded)
      // plus one real sibling
      prisma.topic.findMany = jest.fn().mockResolvedValue([
        focusTopic(),
        {
          id: 'sib-1',
          title: 'Two Sum / complement lookup',
          domain: 'DSA',
          status: 'planned',
          parentId: 'chap-1',
          prerequisites: [],
          prompts: [],
        },
      ]);

      const md = await service.generate({
        mode: 'learn',
        focusTopicId: 'focus-1',
        now: NOW,
        userId: 'u1',
      });

      expect(md).toContain('Export: learn');
      expect(md).toContain('## LEARNING GOAL');
      expect(md).toContain('Topic: Prefix sums [pattern]');
      expect(md).not.toContain('in this chapter started');
      expect(md).toContain(
        '- Hashing fundamentals — **Key insight:** buckets trade memory for time.',
      );
      expect(md).toContain('- Arrays 101');
      expect(md).toContain('Existing cards (do not duplicate):');
      expect(md).toContain('- card c1 [concept] Define a prefix-sum array.');
      expect(md).toContain('## SESSION CONDUCT — learning');
      expect(md).toContain('## OUTPUT CONTRACT');
      expect(md).not.toContain('## MASTERY CONDITIONS');

      const ctxStart = md.indexOf('## CHAPTER CONTEXT');
      const ctxEnd = md.indexOf('## LEARNING GOAL');
      expect(ctxStart).toBeGreaterThan(-1);
      const chapterContext = md.slice(ctxStart, ctxEnd);
      expect(chapterContext).toContain('In this chapter (Arrays & Hashing):');
      expect(chapterContext).toContain('○ Two Sum / complement lookup');
      expect(chapterContext).not.toContain('Prefix sums');
      expect(chapterContext).not.toContain('Builds on (chapters)');

      expect(prisma.topic.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 'u1',
            status: { not: 'archived' },
            OR: [{ parentId: 'chap-1' }, { id: { in: [] } }],
          },
        }),
      );
    });

    it('lists prerequisite chapters under Builds on (chapters), with a placeholder when the chapter itself has no siblings yet', async () => {
      prisma.user.findUnique = jest.fn().mockResolvedValue({ name: 'Dm' });
      prisma.topic.findFirst = jest.fn().mockResolvedValue(
        focusTopic({
          parent: {
            id: 'chap-1',
            title: 'Two Pointers',
            prerequisites: [{ prerequisite: { id: 'chap-0' } }],
          },
        }),
      );
      prisma.topic.findMany = jest.fn().mockResolvedValue([
        {
          id: 'chap-0',
          title: 'Arrays & Hashing',
          domain: 'DSA',
          status: 'mastered',
          parentId: null,
          prerequisites: [],
          prompts: [],
        },
      ]);

      const md = await service.generate({
        mode: 'learn',
        focusTopicId: 'focus-1',
        now: NOW,
        userId: 'u1',
      });

      const ctxStart = md.indexOf('## CHAPTER CONTEXT');
      const ctxEnd = md.indexOf('## LEARNING GOAL');
      const chapterContext = md.slice(ctxStart, ctxEnd);
      expect(chapterContext).toContain('In this chapter (Two Pointers):');
      expect(chapterContext).toContain('- (none yet)');
      expect(chapterContext).toContain('Builds on (chapters):');
      expect(chapterContext).toContain('✓ Arrays & Hashing');

      expect(prisma.topic.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 'u1',
            status: { not: 'archived' },
            OR: [{ parentId: 'chap-1' }, { id: { in: ['chap-0'] } }],
          },
        }),
      );
    });

    it('omits CHAPTER CONTEXT entirely when the focus topic has no parent chapter', async () => {
      prisma.user.findUnique = jest.fn().mockResolvedValue({ name: 'Dm' });
      prisma.topic.findFirst = jest.fn().mockResolvedValue(
        focusTopic({ parentId: null, parent: null }),
      );
      prisma.topic.findMany = jest.fn().mockResolvedValue([]);

      const md = await service.generate({
        mode: 'learn',
        focusTopicId: 'focus-1',
        now: NOW,
        userId: 'u1',
      });

      expect(md).not.toContain('## CHAPTER CONTEXT');
      expect(prisma.topic.findMany).not.toHaveBeenCalled();
    });

    it('defaults the focus to Next Up when focusTopicId is omitted', async () => {
      prisma.user.findUnique = jest.fn().mockResolvedValue({ name: 'Dm' });
      metrics.nextUp = jest.fn().mockResolvedValue({ topic: { id: 'focus-1' } });
      prisma.topic.findFirst = jest.fn().mockResolvedValue(focusTopic());
      prisma.topic.findMany = jest.fn().mockResolvedValue([]);

      const md = await service.generate({ mode: 'learn', now: NOW, userId: 'u1' });
      expect(md).toContain('Topic: Prefix sums');
      expect(prisma.topic.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'focus-1', userId: 'u1' }),
        }),
      );
    });

    it('422s when there is no startable topic and no explicit focus', async () => {
      metrics.nextUp = jest.fn().mockResolvedValue(null);
      await expect(service.generate({ mode: 'learn', now: NOW, userId: 'u1' })).rejects.toThrow(
        'No startable topic — pass focusTopicId or start something from the roadmap.',
      );
    });

    it('404s on an archived focus topic', async () => {
      prisma.topic.findFirst = jest.fn().mockResolvedValue(focusTopic({ status: 'archived' }));
      await expect(
        service.generate({ mode: 'learn', focusTopicId: 'focus-1', now: NOW, userId: 'u1' }),
      ).rejects.toThrow('not found');
    });
  });
});
```

- [ ] **Step 2: Run the suite to confirm the new/changed assertions fail against current production code**

Run: `yarn workspace @terrain/api test -- export-generator.service.spec.ts`
Expected: FAIL — the first three `mode=learn` tests fail (no `## CHAPTER CONTEXT` in output yet; `md` still contains `'in this chapter started'`).

- [ ] **Step 3: Implement `chapterContext()` and rewire `generateLearn()`**

In `apps/api/src/sessions/export-generator.service.ts`, add this new private method directly above `private roadmap(...)` (i.e. right before the current line 238):

```ts
  private chapterContext(
    chapterTitle: string,
    siblings: TopicWithPrereqs[],
    prereqChapters: TopicWithPrereqs[],
  ): string {
    const line = (t: TopicWithPrereqs) => `${this.glyph(t)} ${t.title}${this.reviewingTag(t)}`;
    const siblingBlock = siblings.length > 0 ? siblings.map(line).join('\n') : '- (none yet)';
    const parts = [`In this chapter (${chapterTitle}):\n${siblingBlock}`];
    if (prereqChapters.length > 0) {
      parts.push(`Builds on (chapters):\n${prereqChapters.map(line).join('\n')}`);
    }
    return `## CHAPTER CONTEXT\n${parts.join('\n\n')}`;
  }
```

Then replace the whole `generateLearn` method (current lines 134-205) with:

```ts
  private async generateLearn(userId: string, now: Date, focusTopicId?: string): Promise<string> {
    let focusId = focusTopicId;
    if (!focusId) {
      const next = await this.metrics.nextUp(userId);
      if (!next) {
        throw new UnprocessableEntityException(
          'No startable topic — pass focusTopicId or start something from the roadmap.',
        );
      }
      focusId = next.topic.id;
    }
    const focus = await this.prisma.topic.findFirst({
      where: { id: focusId, userId },
      include: {
        parent: {
          select: {
            id: true,
            title: true,
            prerequisites: { include: { prerequisite: { select: { id: true } } } },
          },
        },
        prerequisites: {
          include: { prerequisite: { select: { title: true, status: true, summary: true } } },
        },
        prompts: {
          where: { suspended: false },
          orderBy: { createdAt: 'asc' },
          select: { id: true, promptKind: true, promptText: true },
        },
      },
    });
    if (!focus || focus.status === 'archived') {
      throw new NotFoundException(`Topic ${focusId} not found`);
    }

    const goal: string[] = [`## LEARNING GOAL`, `Topic: ${focus.title} [${focus.topicType}]`];
    if (focus.description) goal.push(`Description: ${focus.description}`);
    if (focus.aiContext) goal.push(`AI context: ${focus.aiContext}`);
    if (focus.prerequisites.length > 0) {
      const lines = focus.prerequisites.map(({ prerequisite: p }) =>
        p.summary ? `- ${p.title} — ${p.summary}` : `- ${p.title}`,
      );
      goal.push(`Builds on (your existing knowledge):\n${lines.join('\n')}`);
    }
    if (focus.prompts.length > 0) {
      const lines = focus.prompts.map((c) => `- card ${c.id} [${c.promptKind}] ${c.promptText}`);
      goal.push(`Existing cards (do not duplicate):\n${lines.join('\n')}`);
    }

    const sections = [this.header('learn', now), await this.whoIAm(userId)];

    if (focus.parent) {
      const prereqChapterIds = focus.parent.prerequisites.map((p) => p.prerequisite.id);
      const chapterTopics = await this.prisma.topic.findMany({
        where: {
          userId,
          status: { not: 'archived' },
          OR: [{ parentId: focus.parent.id }, { id: { in: prereqChapterIds } }],
        },
        include: {
          prerequisites: { include: { prerequisite: { select: { status: true } } } },
          prompts: { select: { reps: true, stability: true, suspended: true } },
        },
      });
      const siblings = chapterTopics.filter(
        (t) => t.parentId === focus.parent!.id && t.id !== focus.id,
      );
      const prereqChapters = chapterTopics.filter((t) => prereqChapterIds.includes(t.id));
      sections.push(this.chapterContext(focus.parent.title, siblings, prereqChapters));
    }

    sections.push(goal.join('\n'), LEARN_CONDUCT, OUTPUT_CONTRACT);
    return sections.join('\n\n');
  }
```

Note: the old `domainTopics` query and the `this.roadmap(domainTopics...)` call are gone entirely from this method — `roadmap()` itself is untouched and still used by `full`/`domain:<x>` modes elsewhere in the file.

- [ ] **Step 4: Run the suite to confirm everything passes**

Run: `yarn workspace @terrain/api test -- export-generator.service.spec.ts`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Run the full API test suite and lint**

Run: `yarn workspace @terrain/api test && yarn lint`
Expected: PASS — all suites green (255+ tests), no lint errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/sessions/export-generator.service.ts apps/api/src/sessions/export-generator.service.spec.ts
git commit -m "$(cat <<'EOF'
feat: replace full roadmap with chapter context in learn exports

Learn sessions now see the focus topic's chapter siblings and the
chapter's own prerequisite chapters instead of the entire domain tree,
cutting noise and token cost for a session about one sub-pattern.
EOF
)"
```

---

### Task 2: Script roadmap-extension prompting into LEARN_CONDUCT

**Files:**
- Modify: `apps/api/src/sessions/session-conduct.ts` (the `LEARN_CONDUCT` export, currently lines 23-47).

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new (same export name/type — `LEARN_CONDUCT: string`). No test depends on its exact wording.

- [ ] **Step 1: Replace the `LEARN_CONDUCT` export**

In `apps/api/src/sessions/session-conduct.ts`, replace the entire `export const LEARN_CONDUCT = ...` block with:

```ts
export const LEARN_CONDUCT = `## SESSION CONDUCT — learning
Teach me the topic in LEARNING GOAL, then make me prove I learned it. Do not
just lecture — the session must force retrieval, elaboration, and application.
1. Teach Socratically — questions before explanations. Push back if I move too
   fast; enforce confusion time. Connect new material to the prerequisites above.
2. ELABORATE — before you consider the topic taught, make me explain it back
   in my own words: why it works, its invariant, and where it breaks. Probe
   gaps; don't accept a fluent restatement that skips the mechanism.
3. DO — make me actually apply it: implement it from scratch, or solve a novel
   variant that fits the topic type. Check my work. If I genuinely solve a novel
   problem, record it in applicationEvents (see the output contract) so it counts
   toward mastery.
4. CONSPECT — at the end, write me an Obsidian-ready conspect of the topic as
   prose in the chat (not inside the learning-os block) for me to paste into my
   notes; if a diagram would help, describe the OneNote drawing to make.
5. SUGGEST — if a genuinely related or meaningfully deeper topic comes up while
   teaching, say so unprompted and propose it via proposedTopics (see the output
   contract) with real prerequisiteTitles/parentTitle wiring; don't manufacture
   an unrelated topic just to fill the field. If I directly ask whether we should
   add a topic, give me a real yes/no opinion with your reasoning — not
   reflexive agreement.
6. In the learning-os block:
   - propose 3-7 atomic cards via proposedPrompts (mix concept/code/problem as
     fits the topic; don't duplicate the existing cards listed above);
   - write ONE brief noteSummaries entry that points at where the depth lives —
     keyInsight is a 1-2 sentence index (the full conspect is in Obsidian), and
     suggestedNoteRef names the primary Obsidian location;
   - if I solved a novel problem, add an applicationEvents entry;
   - if you proposed a new topic in step 5, include it in proposedTopics;
   - list the topic's title in studiedTopics so the app activates it.
   Only add other titles to studiedTopics if we genuinely studied them in
   depth — never topics merely mentioned.`;
```

- [ ] **Step 2: Confirm existing tests still pass (no test asserts LEARN_CONDUCT's exact text)**

Run: `yarn workspace @terrain/api test -- export-generator.service.spec.ts`
Expected: PASS — the `'## SESSION CONDUCT — learning'` assertion still matches (only the header line, unchanged).

- [ ] **Step 3: Build and lint**

Run: `yarn workspace @terrain/api build && yarn lint`
Expected: PASS, no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/sessions/session-conduct.ts
git commit -m "$(cat <<'EOF'
feat: script roadmap-extension proposals into learn session conduct

The proposedTopics mechanism already existed end-to-end but nothing
told the model to use it during a learn session, or how to respond
when asked directly whether a topic should be added.
EOF
)"
```

---

### Task 3: Review screen lists proposed topics by title

**Files:**
- Modify: `apps/web/src/screens/Session/index.tsx:232-262` (the `step === 'review'` block).

**Interfaces:**
- Consumes: existing `NewTopicPlan` type (`apps/web/src/api/types.ts:279-288`) — fields `title: string`, `parentTitle: string | null`, `prerequisiteTitles: string[]`, `alreadyExists: boolean`. No changes to this type.
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Add the proposed-topics list to the review Card**

In `apps/web/src/screens/Session/index.tsx`, inside the `step === 'review' && plan && (...)` block, immediately after the closing `</div>` of the `stat-strip` div (right after the `<PreviewStat n={plan.noteSummaries.length} label="notes" hideWhenZero />` line and its wrapping `</div>`), insert:

```tsx
            {plan.newTopics.filter((t) => !t.alreadyExists).length > 0 ? (
              <div className="col gap-1">
                <span className="faint">Proposed topics:</span>
                {plan.newTopics
                  .filter((t) => !t.alreadyExists)
                  .map((t, i) => (
                    <span key={i} className="faint" style={{ fontSize: 12 }}>
                      • {t.title}
                      {t.parentTitle ? ` — under ${t.parentTitle}` : ''}
                      {t.prerequisiteTitles.length > 0
                        ? ` (requires: ${t.prerequisiteTitles.join(', ')})`
                        : ''}
                    </span>
                  ))}
              </div>
            ) : null}
```

This mirrors the existing `plan.unresolved.length > 0 ? (...) : null` list rendered a few lines below in the same file — same `faint` / 12px styling convention.

- [ ] **Step 2: Build the web workspace**

Run: `yarn workspace @terrain/web build`
Expected: PASS — `tsc --noEmit` and the Vite build both succeed with no new errors.

- [ ] **Step 3: Manually verify in the browser**

Start the stack if not already running:

```bash
docker compose up -d
yarn workspace @terrain/api start &
yarn workspace @terrain/web dev &
```

Navigate to a `learn`-mode session in the web app (`/session/learn`), reach the paste step, and paste a `learning-os` block that includes a `proposedTopics` entry, e.g.:

```learning-os
{
  "version": 2,
  "sessionId": "<the session id shown in the copied context>",
  "proposedTopics": [
    { "title": "Sliding window on strings", "type": "pattern", "domain": "DSA",
      "description": "test", "prerequisiteTitles": [], "parentTitle": null, "aiContext": "test" }
  ],
  "studiedTopics": []
}
```

Click Preview and confirm the review screen shows a "Proposed topics:" line reading `• Sliding window on strings`. Kill the dev processes when done (`kill -9 $(lsof -ti:3000)` for the API; Ctrl-C the `vite dev` job).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/screens/Session/index.tsx
git commit -m "$(cat <<'EOF'
feat: list proposed topics by title on the session review screen

Previously only a count ("3 new topics") was shown before Save; now
each proposed topic's title, parent chapter, and prerequisites are
visible so a bad suggestion is easy to catch before saving.
EOF
)"
```
