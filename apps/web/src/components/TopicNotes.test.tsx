import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadNotesDraft, notesDraftReducer, NoteText, persistNotesDraft } from './TopicNotes';

afterEach(() => vi.unstubAllGlobals());

function browserStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe('note draft recovery', () => {
  const base = { body: 'saved original', revision: 1, updatedAt: null };
  const latest = { body: 'other device', revision: 2, updatedAt: null };

  it('starts an unsaved template only for empty notes and never replaces existing writing', () => {
    const empty = {
      base: { ...base, body: '' },
      draft: null,
      latest: null,
      conflict: false,
      view: 'read' as const,
    };
    const started = notesDraftReducer(empty, { type: 'template' });
    expect(started.draft).toContain('## My explanation');
    expect(started.draft).toContain('## Example & counterexample');
    expect(started.base.body).toBe('');
    expect(
      notesDraftReducer({ ...empty, draft: 'My explanation' }, { type: 'template' }).draft,
    ).toBe('My explanation');
  });

  it('preserves a dirty draft and its revision when a remote change arrives', () => {
    const state = notesDraftReducer(
      { base, draft: 'my unsaved change', latest: null, conflict: false, view: 'edit' },
      { type: 'loaded', notes: latest },
    );
    expect(state.draft).toBe('my unsaved change');
    expect(state.base.revision).toBe(1);
    expect(state.latest?.body).toBe('other device');
    expect(state.conflict).toBe(true);
    const reconciled = notesDraftReducer(state, { type: 'rebase' });
    expect(reconciled.base.revision).toBe(2);
    expect(reconciled.draft).toBe('my unsaved change');
    expect(reconciled.conflict).toBe(false);
  });

  it('uses the latest remote version only after explicitly cancelling the draft', () => {
    const state = notesDraftReducer(
      { base, draft: 'draft', latest, conflict: true, view: 'edit' },
      { type: 'cancel' },
    );
    expect(state.base).toEqual(latest);
    expect(state.draft).toBeNull();
  });

  it('keeps the draft intact when a save reports a conflict before reload finishes', () => {
    const state = notesDraftReducer(
      { base, draft: 'my work', latest: null, conflict: false, view: 'edit' },
      { type: 'conflict' },
    );
    expect(state.draft).toBe('my work');
    expect(state.base.revision).toBe(1);
    expect(state.conflict).toBe(true);
  });

  it('preserves unsaved text through preview, reading saved notes and returning to edit', () => {
    let state: Parameters<typeof notesDraftReducer>[0] = {
      base,
      draft: 'my work',
      latest,
      conflict: true,
      view: 'edit',
    };
    for (const view of ['preview', 'read', 'edit'] as const) {
      const next = notesDraftReducer(state, { type: 'view', view });
      expect(next.draft).toBe('my work');
      expect(next.base.revision).toBe(1);
      expect(next.conflict).toBe(true);
      expect(next.view).toBe(view);
      state = next;
    }
  });

  it('refreshes an untouched editor without creating a conflict', () => {
    const state = notesDraftReducer(
      { base, draft: base.body, latest: null, conflict: false, view: 'edit' },
      { type: 'loaded', notes: latest },
    );
    expect(state.draft).toBe('other device');
    expect(state.conflict).toBe(false);
  });

  it('restores tab drafts only for the same account and topic, including deleted text', () => {
    vi.stubGlobal('sessionStorage', browserStorage());
    const state = { base, draft: '', latest: null, conflict: false, view: 'edit' as const };
    expect(persistNotesDraft('account-a', 'topic-a', state)).toBe(true);
    const recovered = loadNotesDraft('account-a', 'topic-a', base);
    expect(recovered.recovered).toBe(true);
    expect(recovered.state.draft).toBe('');
    expect(recovered.state.base.revision).toBe(1);
    expect(loadNotesDraft('account-b', 'topic-a', base).state.draft).toBeNull();
    expect(loadNotesDraft('account-a', 'topic-b', base).state.draft).toBeNull();

    const stale = loadNotesDraft('account-a', 'topic-a', latest).state;
    expect(stale.draft).toBe('');
    expect(stale.base.revision).toBe(1);
    expect(stale.latest).toEqual(latest);
    expect(stale.conflict).toBe(true);
    const reconciled = notesDraftReducer(stale, { type: 'rebase' });
    expect(reconciled.draft).toBe('');
    expect(reconciled.base.revision).toBe(2);
    expect(reconciled.conflict).toBe(false);

    const saved = notesDraftReducer(reconciled, {
      type: 'saved',
      notes: { ...latest, body: '', revision: 3 },
    });
    persistNotesDraft('account-a', 'topic-a', saved);
    expect(loadNotesDraft('account-a', 'topic-a', base).state.draft).toBeNull();
  });

  it('keeps independent tab drafts through reloads, saves and discards in the other tab', () => {
    const tabs = [browserStorage(), browserStorage()];
    vi.stubGlobal('localStorage', browserStorage());
    const draft = {
      base,
      draft: 'tab A work',
      latest: null,
      conflict: false,
      view: 'edit' as const,
    };
    vi.stubGlobal('sessionStorage', tabs[0]);
    persistNotesDraft('account-a', 'topic-a', draft);

    vi.stubGlobal('sessionStorage', tabs[1]);
    expect(loadNotesDraft('account-a', 'topic-a', base).state.draft).toBeNull();
    persistNotesDraft('account-a', 'topic-a', { ...draft, draft: 'tab B work' });

    vi.stubGlobal('sessionStorage', tabs[0]);
    const restoredA = loadNotesDraft('account-a', 'topic-a', base).state;
    expect(restoredA.draft).toBe('tab A work');
    const savedA = { body: 'tab A work', revision: 2, updatedAt: '2026-09-25T12:00:00Z' };
    persistNotesDraft(
      'account-a',
      'topic-a',
      notesDraftReducer(restoredA, { type: 'saved', notes: savedA }),
    );

    vi.stubGlobal('sessionStorage', tabs[1]);
    const restoredB = loadNotesDraft('account-a', 'topic-a', savedA).state;
    expect(restoredB.draft).toBe('tab B work');
    expect(restoredB.base.revision).toBe(1);
    expect(restoredB.latest).toEqual(savedA);
    expect(restoredB.conflict).toBe(true);

    vi.stubGlobal('sessionStorage', tabs[0]);
    persistNotesDraft('account-a', 'topic-a', {
      ...draft,
      base: savedA,
      draft: 'tab A continuation',
    });
    vi.stubGlobal('sessionStorage', tabs[1]);
    persistNotesDraft('account-a', 'topic-a', notesDraftReducer(restoredB, { type: 'cancel' }));
    expect(loadNotesDraft('account-a', 'topic-a', savedA).state.draft).toBeNull();
    vi.stubGlobal('sessionStorage', tabs[0]);
    expect(loadNotesDraft('account-a', 'topic-a', savedA).state.draft).toBe('tab A continuation');
  });

  it('keeps a failed-save conflict after recovery even when the latest reload has not arrived', () => {
    let value: string | null = null;
    vi.stubGlobal('sessionStorage', {
      getItem: () => value,
      setItem: (_key: string, next: string) => {
        value = next;
      },
    });
    persistNotesDraft('a', 'topic', {
      base,
      draft: 'work',
      latest: null,
      conflict: true,
      view: 'edit',
    });
    const state = loadNotesDraft('a', 'topic', base).state;
    expect(state.draft).toBe('work');
    expect(state.conflict).toBe(true);
    expect(state.latest).toBeNull();
  });

  it('reports blocked storage without losing the editable draft', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    });
    expect(loadNotesDraft('a', 'topic', base).storageAvailable).toBe(false);
    const state = {
      base,
      draft: 'keep this work',
      latest: null,
      conflict: false,
      view: 'edit' as const,
    };
    expect(persistNotesDraft('a', 'topic', state)).toBe(false);
    expect(state.draft).toBe('keep this work');
  });

  it('ignores malformed or oversized stored drafts instead of trusting browser data', () => {
    for (const value of [
      '{broken',
      JSON.stringify({ version: 1, base, draft: 'x'.repeat(100_001), conflict: false }),
      JSON.stringify({
        version: 1,
        base: { ...base, revision: -1 },
        draft: 'work',
        conflict: false,
      }),
    ]) {
      vi.stubGlobal('sessionStorage', { getItem: () => value });
      expect(loadNotesDraft('a', 'topic', base).state.draft).toBeNull();
    }
  });
});

describe('readable notes', () => {
  it('renders headings, lists and code while keeping HTML and unsafe links inert', () => {
    const html = renderToStaticMarkup(
      <NoteText
        text={
          '## Mechanism\n\n- **One** step\n- Another\n\n```js\n<script>alert(1)</script>\n```\n\n[docs](https://example.com) [bad](javascript:alert)\n<img src=x onerror=alert(1)>'
        }
      />,
    );
    expect(html).toContain('<h3');
    expect(html).toContain('<ul');
    expect(html).toContain('<strong>One</strong>');
    expect(html).toContain('<pre');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('<img');
  });

  it('preserves heading hierarchy and paragraph boundaries for long notes', () => {
    const html = renderToStaticMarkup(
      <NoteText
        text={
          '# Overview\n\n## Mechanism\n\n### Details\n\nA wrapped\nparagraph.\n\nAnother paragraph.'
        }
      />,
    );
    expect(html).toContain('<h2>Overview</h2>');
    expect(html).toContain('<h3>Mechanism</h3>');
    expect(html).toContain('<h4>Details</h4>');
    expect(html).toContain('A wrapped\nparagraph.');
    expect(html.match(/<p>/g)).toHaveLength(2);
  });
});
