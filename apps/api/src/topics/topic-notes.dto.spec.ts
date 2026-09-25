import { validateSync } from 'class-validator';
import { UpdateTopicNotesDto } from './dto';

describe('topic notes input', () => {
  it('accepts an empty note and revision zero, but rejects unsafe sizes and revisions', () => {
    const validate = (input: unknown) =>
      validateSync(Object.assign(new UpdateTopicNotesDto(), input));
    expect(validate({ body: '', revision: 0 })).toEqual([]);
    for (const input of [
      { body: 'a'.repeat(100_001), revision: 0 },
      { body: null, revision: 0 },
      { body: 'notes', revision: -1 },
      { body: 'notes', revision: 1.5 },
      { body: 'notes', revision: '1' },
      { body: 'notes', revision: 2147483647 },
    ])
      expect(validate(input).length).toBeGreaterThan(0);
  });
});
