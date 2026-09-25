import { describe, expect, it } from 'vitest';
import type { ImportPlan, ImportResult } from '../../api/types';
import { importedNoteTopics } from './NotesHandoff';

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
};
const result: ImportResult = {
  sessionExportId: 'session',
  reviewsApplied: 0,
  topicsCreated: [],
  promptsCreated: 0,
  duplicatePromptsSkipped: 0,
  noteSummariesApplied: 0,
  appEventsApplied: 0,
  nextSessionStored: false,
  topicsActivated: 0,
  topicsMastered: 0,
  sourceEvidenceApplied: 0,
};
const topics = [
  { id: 'reviewed', title: 'Reviewed topic', topicType: 'concept' },
  { id: 'new-id', title: 'New topic', topicType: 'concept' },
  { id: 'unrelated', title: 'Next topic', topicType: 'concept' },
];

describe('notes links after import', () => {
  it('links processed topics once and includes created IDs without linking next-session suggestions', () => {
    const imported: ImportPlan = {
      ...plan,
      reviews: [
        {
          kind: 'card',
          promptId: 'p',
          topicId: 'reviewed',
          topicTitle: 'Reviewed topic',
          promptText: 'Question',
          grade: 'good',
        },
      ],
      noteSummaries: [
        { resolvedTopicId: 'reviewed', topicTitle: 'Reviewed topic', composedSummary: 'Summary' },
        { resolvedTopicId: null, topicTitle: 'New topic', composedSummary: 'New summary' },
      ],
      nextSession: { focusTitle: 'Next topic' },
    };
    expect(importedNoteTopics(imported, { ...result, topicsCreated: ['new-id'] }, topics)).toEqual([
      { id: 'reviewed', title: 'Reviewed topic' },
      { id: 'new-id', title: 'New topic' },
    ]);
  });

  it('can open newly created topic notes before the topic list refresh finishes', () => {
    expect(importedNoteTopics(plan, { ...result, topicsCreated: ['new-id'] }, [])).toEqual([
      { id: 'new-id', title: 'New topic 1' },
    ]);
  });

  it('resolves qualified card topics without choosing an ambiguous title or skipped duplicate', () => {
    const imported: ImportPlan = {
      ...plan,
      newPrompts: [
        {
          topicTitle: 'Queues [concept]',
          promptText: 'Question',
          promptKind: 'concept',
          duplicate: false,
        },
        { topicTitle: 'Queues', promptText: 'Ambiguous', promptKind: 'concept', duplicate: false },
        { topicTitle: 'Next topic', promptText: 'Skipped', promptKind: 'concept', duplicate: true },
      ],
    };
    expect(
      importedNoteTopics(imported, result, [
        ...topics,
        { id: 'queue-concept', title: 'Queues', topicType: 'concept' },
        { id: 'queue-system', title: 'Queues', topicType: 'system' },
      ]),
    ).toEqual([{ id: 'queue-concept', title: 'Queues' }]);
  });

  it('keeps existing topic IDs from the plan when the topic list is unavailable', () => {
    expect(
      importedNoteTopics(
        {
          ...plan,
          activations: [
            {
              topicTitle: 'Studied',
              resolvedTopicId: 'studied-id',
              currentStatus: 'active',
              willActivate: false,
            },
          ],
          applicationEvents: [
            {
              topicTitle: 'Applied',
              resolvedTopicId: 'applied-id',
              kind: 'problem_solved',
              description: 'Solved',
            },
          ],
        },
        result,
        [],
      ),
    ).toEqual([
      { id: 'studied-id', title: 'Studied' },
      { id: 'applied-id', title: 'Applied' },
    ]);
  });
});
