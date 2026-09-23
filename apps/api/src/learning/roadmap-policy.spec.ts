import { buildRoadmapPolicy, type RoadmapNode } from './roadmap-policy';

const node = (
  id: string,
  status: RoadmapNode['status'],
  parentId: string | null = null,
  prerequisiteIds: string[] = [],
): RoadmapNode => ({ id, status, parentId, prerequisiteIds });

describe('buildRoadmapPolicy', () => {
  it('identifies a lesson requiring its containing chapter as a cycle, even after activation', () => {
    for (const status of ['planned', 'active'] as const) {
      const result = buildRoadmapPolicy([
        node('chapter', 'active'),
        node('lesson', status, 'chapter', ['chapter']),
        node('next', 'planned', null, ['chapter']),
      ]);
      expect(result.get('lesson')).toMatchObject({
        cycle: true,
        satisfied: false,
        learnable: false,
      });
      expect(result.get('chapter')).toMatchObject({ cycle: true, satisfied: false });
      expect(result.get('next')?.learnable).toBe(false);
    }
  });

  it('detects cycles through inherited prerequisites and another chapter’s descendants', () => {
    const result = buildRoadmapPolicy([
      node('a', 'planned', null, ['b']),
      node('a-leaf', 'planned', 'a'),
      node('b', 'planned'),
      node('b-leaf', 'planned', 'b', ['a-leaf']),
      node('unrelated', 'planned'),
    ]);
    expect(result.get('a-leaf')).toMatchObject({ cycle: true, learnable: false });
    expect(result.get('b-leaf')).toMatchObject({ cycle: true, learnable: false });
    expect(result.get('unrelated')).toMatchObject({ cycle: false, learnable: true });
  });

  it('detects a direct prerequisite cycle independently of recorded learning status', () => {
    const result = buildRoadmapPolicy([
      node('a', 'active', null, ['b']),
      node('b', 'active', null, ['a']),
    ]);
    expect(result.get('a')).toMatchObject({ cycle: true, satisfied: false });
    expect(result.get('b')).toMatchObject({ cycle: true, satisfied: false });
  });

  it('keeps Accounts blocked while Blockchain basics is 5/13', () => {
    const basics = Array.from({ length: 13 }, (_, i) =>
      node(`basic-${i + 1}`, i < 5 ? 'active' : 'planned', 'basics'),
    );
    const result = buildRoadmapPolicy([
      node('basics', 'active'),
      ...basics,
      node('accounts', 'planned', null, ['basics']),
    ]);

    expect(result.get('basics')).toMatchObject({
      kind: 'group',
      satisfied: false,
      learnedLeaves: 5,
      totalLeaves: 13,
    });
    expect(result.get('accounts')).toMatchObject({
      learnable: false,
      blockerIds: ['basics'],
    });
  });

  it('unlocks Accounts at 13/13 active or mastered', () => {
    const result = buildRoadmapPolicy([
      node('basics', 'active'),
      ...Array.from({ length: 13 }, (_, i) =>
        node(`basic-${i + 1}`, i % 2 ? 'active' : 'mastered', 'basics'),
      ),
      node('accounts', 'planned', null, ['basics']),
    ]);

    expect(result.get('accounts')?.learnable).toBe(true);
  });

  it('inherits a group prerequisite through arbitrarily nested descendants', () => {
    const graph = (learnedBasics: number, ownPrerequisite: RoadmapNode['status']) => [
      node('basics', 'active'),
      ...Array.from({ length: 13 }, (_, index) =>
        node(
          `basic-${index + 1}`,
          index < learnedBasics ? (index % 2 ? 'active' : 'mastered') : 'planned',
          'basics',
        ),
      ),
      node('accounts', 'planned', null, ['basics']),
      node('account-details', 'planned', 'accounts'),
      node('nonce', ownPrerequisite),
      node('transaction-anatomy', 'planned', 'account-details', ['nonce']),
    ];

    const blocked = buildRoadmapPolicy(graph(5, 'active'));
    expect(blocked.get('transaction-anatomy')).toMatchObject({
      learnable: false,
      blockerIds: ['basics'],
    });

    const ownBlocker = buildRoadmapPolicy(graph(13, 'planned'));
    expect(ownBlocker.get('transaction-anatomy')).toMatchObject({
      learnable: false,
      blockerIds: ['nonce'],
    });

    expect(buildRoadmapPolicy(graph(13, 'active')).get('transaction-anatomy')?.learnable).toBe(
      true,
    );
  });

  it('treats an archived descendant as unfinished', () => {
    const result = buildRoadmapPolicy([
      node('basics', 'active'),
      node('wallets', 'active', 'basics'),
      node('hashing', 'archived', 'basics'),
      node('accounts', 'planned', null, ['basics']),
    ]);
    expect(result.get('accounts')?.learnable).toBe(false);
    expect(result.get('basics')?.unfinishedLeafIds).toEqual(['hashing']);
  });

  it('preserves the active direct-leaf prerequisite rule', () => {
    const result = buildRoadmapPolicy([
      node('arrays', 'active'),
      node('two-sum', 'planned', null, ['arrays']),
    ]);
    expect(result.get('two-sum')?.learnable).toBe(true);
  });

  it('fails closed and terminates on a hierarchy cycle', () => {
    const result = buildRoadmapPolicy([
      node('a', 'active', 'b'),
      node('b', 'active', 'a'),
      node('descendant', 'planned', 'a'),
      node('target', 'planned', null, ['a']),
    ]);
    expect(result.get('a')?.cycle).toBe(true);
    expect(result.get('target')?.learnable).toBe(false);
    expect(result.get('descendant')).toMatchObject({
      learnable: false,
      cycle: true,
    });
  });

  it('fails closed when a prerequisite is outside the owned graph', () => {
    const result = buildRoadmapPolicy([
      node('group', 'planned', null, ['foreign-marker']),
      node('target', 'planned', 'group'),
    ]);
    expect(result.get('target')).toMatchObject({
      learnable: false,
      satisfied: false,
      blockerIds: [],
      unavailablePrerequisite: true,
    });
    expect(JSON.stringify(result.get('target'))).not.toContain('foreign-marker');
  });

  it('fails closed when a parent is outside the owned graph', () => {
    const result = buildRoadmapPolicy([
      node('planned-orphan', 'planned', 'foreign-parent'),
      node('active-orphan', 'active', 'foreign-parent'),
      node('descendant', 'planned', 'active-orphan'),
    ]);

    expect(result.get('planned-orphan')).toMatchObject({
      kind: 'leaf',
      learnable: false,
      malformedParent: true,
    });
    expect(result.get('active-orphan')).toMatchObject({
      satisfied: false,
      malformedParent: true,
    });
    expect(result.get('descendant')).toMatchObject({
      learnable: false,
      malformedParent: true,
    });
  });
});
