import { StreakCron } from './streak.cron';

describe('StreakCron', () => {
  it('passes the same instant to each learner and continues when one evaluation fails', async () => {
    const evaluateCompletedDays = jest
      .fn()
      .mockRejectedValueOnce(new Error('temporarily unavailable'))
      .mockResolvedValue(undefined);
    const cron = new StreakCron(
      { evaluateCompletedDays } as any,
      {
        user: { findMany: async () => [{ id: 'a' }, { id: 'b' }] },
      } as any,
    );
    const now = new Date('2026-09-25T22:20:00Z');
    await cron.evaluateYesterday(now);
    expect(evaluateCompletedDays.mock.calls).toEqual([
      ['a', now],
      ['b', now],
    ]);
  });
});
