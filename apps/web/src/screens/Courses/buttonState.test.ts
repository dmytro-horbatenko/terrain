import { describe, expect, it } from 'vitest';
import { courseButtonState } from './buttonState';

describe('courseButtonState', () => {
  it('returns "importing" while a mutation is pending, regardless of imported', () => {
    expect(courseButtonState({ imported: false }, true)).toBe('importing');
    expect(courseButtonState({ imported: true }, true)).toBe('importing');
  });

  it('returns "added" when imported and not pending', () => {
    expect(courseButtonState({ imported: true }, false)).toBe('added');
  });

  it('returns "import" when not imported and not pending', () => {
    expect(courseButtonState({ imported: false }, false)).toBe('import');
  });
});
