import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './client';
describe('learning import transport with paired notes', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('sends only the learning block to both endpoints even with a large valid note', async () => {
    const raw =
      '```learning-os\n{"version":2,"sessionId":"051ac96c-5139-41c8-9b05-c74a0447e335"}\n```\n```note-review\n' +
      JSON.stringify({
        version: 1,
        id: 'ba393504-46ed-4bb0-bbe4-e446cd2f6484',
        topicId: '051ac96c-5139-41c8-9b05-c74a0447e335',
        kind: 'notes',
        baseRevision: 1,
        baseSha256: 'a'.repeat(64),
        body: 'я'.repeat(60_000),
        reason: 'Clarify',
        sourcesChecked: [],
      }) +
      '\n```';
    const fetch = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response('{}', { status: 200 })));
    vi.stubGlobal('fetch', fetch);
    await api.importPreview(raw);
    await api.importApply(raw);
    for (const [, init] of fetch.mock.calls) {
      const payload = String(init.body);
      expect(new TextEncoder().encode(payload).length).toBeLessThan(100_000);
      expect(JSON.parse(JSON.parse(payload).raw)).toEqual({
        version: 2,
        sessionId: '051ac96c-5139-41c8-9b05-c74a0447e335',
      });
      expect(payload).not.toContain('note-review');
    }
  });
  it('keeps standalone raw learning JSON unchanged', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const raw = '{"version":2,"reviews":[]}';
    await api.importPreview(raw);
    expect(JSON.parse(fetch.mock.calls[0][1].body).raw).toBe(raw);
  });
});
