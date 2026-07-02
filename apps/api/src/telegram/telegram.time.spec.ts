import { localDayStart, localHour } from './telegram.time';

describe('localHour', () => {
  const t = new Date('2026-07-02T06:30:00Z');

  it('resolves the hour across timezones', () => {
    expect(localHour(t, 'UTC')).toBe(6);
    expect(localHour(t, 'Europe/Kyiv')).toBe(9); // UTC+3 in July (EEST)
    expect(localHour(t, 'America/Los_Angeles')).toBe(23); // previous day, UTC-7 (PDT)
  });

  it('returns 0 (not 24) at local midnight', () => {
    expect(localHour(new Date('2026-07-02T00:10:00Z'), 'UTC')).toBe(0);
  });

  it('tracks a DST transition (Kyiv is UTC+2 in winter, UTC+3 in summer)', () => {
    expect(localHour(new Date('2026-01-15T07:00:00Z'), 'Europe/Kyiv')).toBe(9);
    expect(localHour(new Date('2026-07-15T07:00:00Z'), 'Europe/Kyiv')).toBe(10);
  });
});

describe('localDayStart', () => {
  it('returns the UTC instant of local midnight', () => {
    const now = new Date('2026-07-02T06:30:00Z');
    expect(localDayStart(now, 'UTC').toISOString()).toBe('2026-07-02T00:00:00.000Z');
    // Kyiv midnight Jul 2 (UTC+3) is 21:00 UTC on Jul 1
    expect(localDayStart(now, 'Europe/Kyiv').toISOString()).toBe('2026-07-01T21:00:00.000Z');
    // In LA it is still Jul 1; LA midnight Jul 1 (UTC-7) is 07:00 UTC Jul 1
    expect(localDayStart(now, 'America/Los_Angeles').toISOString()).toBe(
      '2026-07-01T07:00:00.000Z',
    );
  });
});
