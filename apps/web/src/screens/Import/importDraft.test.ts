import { describe, expect, it } from 'vitest';
import type { ImportPlan } from '../../api/types';
import {
  emptyImportDraft,
  hasImportContent,
  importDraftReducer,
  type ImportDraft,
} from './importDraft';

const plan: ImportPlan = {
  sessionExportId: 'session-a',
  alreadyImported: false,
  applicable: true,
  reviews: [],
  newTopics: [],
  newPrompts: [],
  noteSummaries: [],
  unresolved: [],
  activations: [],
};

describe('recognizing pasted chat output', () => {
  it('finds the import after Markdown notes and unrelated code fences', () => {
    expect(
      hasImportContent(
        '# Topic notes\n```js\nconst count = 1;\n```\n\n```learning-os\n{"version":2}\n```',
      ),
    ).toBe(true);
    expect(hasImportContent('  {"version":2}')).toBe(true);
  });

  it('waits for a complete learning-os block instead of previewing partial notes', () => {
    expect(hasImportContent('# Notes\n```js\n{}\n```')).toBe(false);
    expect(hasImportContent('```learning-os\n{"version":2}')).toBe(false);
    expect(hasImportContent('```learning-os\n{"version":')).toBe(false);
  });
});

describe('preview input identity', () => {
  it('invalidates a successful plan immediately when the input changes', () => {
    let draft = importDraftReducer(emptyImportDraft, { type: 'change', text: 'first' });
    draft = importDraftReducer(draft, { type: 'preview', requestId: 1, text: 'first' });
    draft = importDraftReducer(draft, { type: 'success', requestId: 1, plan });
    expect(draft.plan?.applicable).toBe(true);
    draft = importDraftReducer(draft, { type: 'change', text: 'edited' });
    expect(draft.plan).toBeNull();
    expect(draft.attempted).toBe(false);
  });

  it('ignores an in-flight preview after edits, including edits back to the original text', () => {
    let draft = importDraftReducer(emptyImportDraft, { type: 'change', text: 'first' });
    draft = importDraftReducer(draft, { type: 'preview', requestId: 1, text: 'first' });
    draft = importDraftReducer(draft, { type: 'change', text: 'second' });
    draft = importDraftReducer(draft, { type: 'change', text: 'first' });
    draft = importDraftReducer(draft, { type: 'success', requestId: 1, plan });
    expect(draft.plan).toBeNull();
    expect(draft.text).toBe('first');
    expect(draft.attempted).toBe(false);
  });

  it('keeps the newest preview when older responses arrive out of order', () => {
    let draft = importDraftReducer(emptyImportDraft, { type: 'preview', requestId: 1, text: '' });
    draft = importDraftReducer(draft, { type: 'preview', requestId: 2, text: '' });
    const newer = { ...plan, sessionExportId: 'session-b' };
    draft = importDraftReducer(draft, { type: 'success', requestId: 2, plan: newer });
    draft = importDraftReducer(draft, { type: 'success', requestId: 1, plan });
    draft = importDraftReducer(draft, { type: 'error', requestId: 1, error: new Error('old') });
    expect(draft.plan?.sessionExportId).toBe('session-b');
    expect(draft.error).toBeNull();
    expect(draft.requestId).toBeNull();
  });

  it('clears the previous plan during a manual rerun and exposes the current error', () => {
    let draft: ImportDraft = { ...emptyImportDraft, text: 'first', plan };
    draft = importDraftReducer(draft, { type: 'preview', requestId: 3, text: 'first' });
    expect(draft.plan).toBeNull();
    expect(draft.requestId).toBe(3);
    draft = importDraftReducer(draft, { type: 'error', requestId: 3, error: 'invalid input' });
    expect(draft.error).toBe('invalid input');
    expect(draft.requestId).toBeNull();
  });

  it('ignores a scheduled preview that starts after its input has changed', () => {
    let draft = importDraftReducer(emptyImportDraft, { type: 'change', text: 'edited' });
    draft = importDraftReducer(draft, { type: 'preview', requestId: 4, text: 'original' });
    draft = importDraftReducer(draft, { type: 'success', requestId: 4, plan });
    expect(draft.plan).toBeNull();
    expect(draft.text).toBe('edited');
    expect(draft.attempted).toBe(false);
  });
});
