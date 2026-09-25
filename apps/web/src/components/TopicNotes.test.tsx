import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { notesDraftReducer, NoteText } from './TopicNotes';

describe('note draft recovery', () => {
  const base = { body: 'saved original', revision: 1, updatedAt: null };
  const latest = { body: 'other device', revision: 2, updatedAt: null };

  it('starts an unsaved template only for empty notes and never replaces existing writing', () => {
    const empty = { base: { ...base, body: '' }, draft: null, latest: null, conflict: false };
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
      { base, draft: 'my unsaved change', latest: null, conflict: false },
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
      { base, draft: 'draft', latest, conflict: true },
      { type: 'cancel' },
    );
    expect(state.base).toEqual(latest);
    expect(state.draft).toBeNull();
  });

  it('keeps the draft intact when a save reports a conflict before reload finishes', () => {
    const state = notesDraftReducer(
      { base, draft: 'my work', latest: null, conflict: false },
      { type: 'conflict' },
    );
    expect(state.draft).toBe('my work');
    expect(state.base.revision).toBe(1);
    expect(state.conflict).toBe(true);
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
});
