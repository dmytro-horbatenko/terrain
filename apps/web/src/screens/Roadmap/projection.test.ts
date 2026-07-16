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
    sourcePlan: null,
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
    expect(p.edges).toEqual([{ id: 'ghost-a2->b1', source: 'a2', target: 'b1', kind: 'ghost' }]);
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
      topics,
      focusId: 'B',
      domain: '__all__',
      showParked: false,
      nextUpId: null,
    });
    expect(off.items.some((i) => i.topic.id === 'p1')).toBe(false);
    const on = projectRoadmap({
      topics,
      focusId: 'B',
      domain: '__all__',
      showParked: true,
      nextUpId: null,
    });
    expect(on.items.some((i) => i.kind === 'leaf' && i.topic.id === 'p1')).toBe(true);
  });

  it('filters by domain and falls back to root when the focus is filtered out', () => {
    const other = topic({ id: 'x1', title: 'Other domain', domain: 'Systems' });
    const p = projectRoadmap({
      topics: [...TOPICS, other],
      focusId: 'x-gone',
      domain: 'Systems',
      showParked: false,
      nextUpId: null,
    });
    expect(p.effectiveFocusId).toBeNull();
    expect(p.items).toEqual([{ kind: 'leaf', topic: other, isNextUp: false }]);
    expect(p.breadcrumb).toEqual([]);
  });
});
