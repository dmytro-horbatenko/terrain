import { describe, expect, it } from 'vitest';
import { courseButtonState, courseDisableButtonState } from './buttonState';

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

describe('courseDisableButtonState', () => {
  it('returns "pause" when enabled and not pending', () => {
    expect(courseDisableButtonState({ disabled: false }, false)).toBe('pause');
  });

  it('returns "resume" when disabled and not pending', () => {
    expect(courseDisableButtonState({ disabled: true }, false)).toBe('resume');
  });

  it('returns "pausing" when currently enabled and a toggle is pending (heading toward disabled)', () => {
    expect(courseDisableButtonState({ disabled: false }, true)).toBe('pausing');
  });

  it('returns "resuming" when currently disabled and a toggle is pending (heading toward enabled)', () => {
    expect(courseDisableButtonState({ disabled: true }, true)).toBe('resuming');
  });
});
