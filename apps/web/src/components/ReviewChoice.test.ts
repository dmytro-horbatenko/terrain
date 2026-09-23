import { expect, it, vi } from 'vitest';
import { hasContinuedToday, rememberContinueToday } from './ReviewChoice';

it('keeps continue-today scoped to the learner and local calendar day', () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  expect(hasContinuedToday('learner-a', '2026-09-03')).toBe(false);
  rememberContinueToday('learner-a', '2026-09-03');
  expect(hasContinuedToday('learner-a', '2026-09-03')).toBe(true);
  expect(hasContinuedToday('learner-b', '2026-09-03')).toBe(false);
  expect(hasContinuedToday('learner-a', '2026-09-04')).toBe(false);
  vi.unstubAllGlobals();
});

it('keeps an explicit choice working for this visit when browser storage is unavailable', () => {
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw new Error('disabled');
    },
    setItem: () => {
      throw new Error('disabled');
    },
  });
  rememberContinueToday('storage-disabled', '2026-09-03');
  expect(hasContinuedToday('storage-disabled', '2026-09-03')).toBe(true);
  expect(hasContinuedToday('storage-disabled', '2026-09-04')).toBe(false);
  vi.unstubAllGlobals();
});
