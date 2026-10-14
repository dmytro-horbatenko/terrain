import { describe, expect, it } from 'vitest';
import type { ImportPlan, ImportResult } from '../../api/types';
import { importedPracticeTopics } from './PracticeHandoff';

const plan: ImportPlan = {
  sessionExportId: 'session',
  alreadyImported: false,
  applicable: true,
  reviews: [],
  newTopics: [],
  newPrompts: [],
  noteSummaries: [],
  unresolved: [],
  activations: [],
  applicationEvents: [
    {
      topicTitle: 'Storage references',
      resolvedTopicId: 'storage',
      kind: 'problem_solved',
      description: 'Traced a mutation with hints.',
    },
  ],
  nextSession: { focusTitle: 'Opcodes' },
};
const result: ImportResult = {
  sessionExportId: 'session',
  reviewsApplied: 0,
  topicsCreated: [],
  promptsCreated: 0,
  duplicatePromptsSkipped: 0,
  noteSummariesApplied: 0,
  appEventsApplied: 1,
  nextSessionStored: true,
  topicsActivated: 0,
  topicsMastered: 0,
  sourceEvidenceApplied: 0,
};

describe('delayed practice after import', () => {
  it('offers the actually practiced topic once, without assessing it or choosing the next topic', () => {
    const imported = {
      ...plan,
      applicationEvents: [...plan.applicationEvents!, ...plan.applicationEvents!],
    };
    expect(importedPracticeTopics(imported, { ...result, appEventsApplied: 2 }, [])).toEqual([
      { id: 'storage', title: 'Storage references' },
    ]);
    expect(importedPracticeTopics(plan, { ...result, appEventsApplied: 0 }, [])).toEqual([]);
  });

  it('waits for the actual created topic and never guesses an ambiguous or stale title match', () => {
    const imported = {
      ...plan,
      applicationEvents: [{ ...plan.applicationEvents![0], resolvedTopicId: null }],
    };
    const created = { ...result, topicsCreated: ['created'] };
    const topic = { id: 'created', title: 'Storage references', topicType: 'concept' };
    expect(importedPracticeTopics(imported, created, [])).toEqual([]);
    expect(importedPracticeTopics(imported, created, [{ ...topic, id: 'stale' }])).toEqual([]);
    expect(importedPracticeTopics(imported, created, [topic])).toEqual([
      { id: 'created', title: 'Storage references' },
    ]);
    expect(
      importedPracticeTopics(imported, { ...created, topicsCreated: ['created', 'second'] }, [
        topic,
        { ...topic, id: 'second', topicType: 'pattern' },
      ]),
    ).toEqual([]);
  });
});
