import { planCourseUpdate } from './course-update';

const topic = (over: any = {}) => ({
  title: 'Lesson',
  domain: 'Web3',
  type: 'concept',
  description: 'Original',
  aiContext: null,
  sourcePlan: null,
  prerequisiteTitles: ['Old prerequisite'],
  parentTitle: null,
  ...over,
});
const stored = (over: any = {}) => ({
  id: 'lesson',
  title: 'Lesson',
  domain: 'Web3',
  status: 'active',
  description: 'Original',
  aiContext: null,
  sourcePlan: null,
  parentId: null,
  curriculumOrder: 0,
  prerequisites: [{ prerequisiteId: 'old' }],
  prompts: [],
  ...over,
});
const old = stored({ id: 'old', title: 'Old prerequisite', prerequisites: [] });
const next = stored({
  id: 'next',
  title: 'New prerequisite',
  prerequisites: [],
  curriculumOrder: 1,
});
const catalogue = (topics: any[], prompts: any[] = []) => ({ topics, prompts });

describe('prepared course updates', () => {
  it('replaces authored gates and metadata without changing learning state', () => {
    const desired = catalogue([
      topic({ description: 'Improved', prerequisiteTitles: ['New prerequisite'] }),
    ]);
    const plan = planCourseUpdate(desired, catalogue([topic()]), [stored(), old, next], []);
    expect(plan.topicUpdates).toEqual([
      {
        id: 'lesson',
        title: 'Lesson',
        data: { description: 'Improved' },
        prerequisiteTitles: ['New prerequisite'],
      },
    ]);
    expect(plan.issues).toEqual([]);
  });

  it('preserves user-edited fields and custom prerequisite sets', () => {
    const desired = catalogue([
      topic({ description: 'Improved', prerequisiteTitles: ['New prerequisite'] }),
    ]);
    const plan = planCourseUpdate(
      desired,
      catalogue([topic()]),
      [
        stored({
          description: 'My explanation',
          prerequisites: [{ prerequisiteId: 'old' }, { prerequisiteId: 'next' }],
        }),
        old,
        next,
      ],
      [],
    );
    expect(plan.topicUpdates).toEqual([]);
    expect(plan.preservedChanges).toEqual(
      expect.arrayContaining([
        'Lesson: custom description preserved',
        'Lesson: custom prerequisites preserved',
      ]),
    );
  });

  it('handles forward links to new topics and becomes a no-op after applying', () => {
    const desired = catalogue([
      topic({ prerequisiteTitles: ['New prerequisite'] }),
      topic({ title: 'New prerequisite', prerequisiteTitles: [] }),
    ]);
    const plan = planCourseUpdate(desired, catalogue([]), [], []);
    expect(plan.newTopics).toHaveLength(2);
    expect(plan.issues).toEqual([]);
    const current = [stored({ prerequisites: [{ prerequisiteId: 'next' }] }), next];
    expect(planCourseUpdate(desired, catalogue([]), current, []).topicUpdates).toEqual([]);
  });

  it('blocks a new cycle and detects a stale preview when metadata changes', () => {
    const desired = catalogue([topic({ prerequisiteTitles: ['New prerequisite'] })]);
    const current = [
      stored(),
      old,
      stored({
        id: 'next',
        title: 'New prerequisite',
        prerequisites: [{ prerequisiteId: 'lesson' }],
      }),
    ];
    const plan = planCourseUpdate(desired, catalogue([topic()]), current, []);
    expect(plan.issues.join(' ')).toMatch(/cycle/i);
    expect(plan.fingerprint).not.toBe(
      planCourseUpdate(
        desired,
        catalogue([topic()]),
        [stored({ description: 'Edited meanwhile' }), old, next],
        [],
      ).fingerprint,
    );
  });

  it('updates an authored long prompt in place and never rewrites a custom card', () => {
    const before = {
      topicTitle: 'Lesson',
      promptText: 'Build a whole interpreter',
      promptKind: 'problem',
      estimatedMinutes: 240,
    };
    const after = { ...before, promptText: 'Trace this small program', estimatedMinutes: 10 };
    const changes = [
      { topicTitle: 'Lesson', previousPromptText: before.promptText, promptText: after.promptText },
    ];
    const current = stored({ prompts: [{ id: 'card', ...before, stability: 50, reps: 12 }] });
    const plan = planCourseUpdate(
      catalogue([topic()], [after]),
      catalogue([topic()], [before]),
      [current, old],
      changes,
    );
    expect(plan.promptUpdates).toEqual([
      {
        id: 'card',
        topicTitle: 'Lesson',
        data: { promptText: after.promptText, estimatedMinutes: 10 },
      },
    ]);
    expect(plan.newPrompts).toEqual([]);
    const customized = planCourseUpdate(
      catalogue([topic()], [after]),
      catalogue([topic()], [before]),
      [stored({ prompts: [{ id: 'card', ...before, answerHint: 'My explanation' }] }), old],
      changes,
    );
    expect(customized.promptUpdates[0].data).not.toHaveProperty('answerHint');
  });
});
