import { localDayBounds, localDayStart, localHour } from './telegram.time';

describe('localDayBounds', () => {
  it.each([
    [
      '2026-03-29T12:00:00Z',
      'Europe/Sofia',
      '2026-03-28T22:00:00.000Z',
      '2026-03-29T21:00:00.000Z',
      '2026-03-29',
    ],
    [
      '2026-10-25T12:00:00Z',
      'Europe/Sofia',
      '2026-10-24T21:00:00.000Z',
      '2026-10-25T22:00:00.000Z',
      '2026-10-25',
    ],
    [
      '2026-09-25T22:00:00Z',
      'Asia/Kathmandu',
      '2026-09-25T18:15:00.000Z',
      '2026-09-26T18:15:00.000Z',
      '2026-09-26',
    ],
    [
      '2026-09-25T01:00:00Z',
      'America/Los_Angeles',
      '2026-09-24T07:00:00.000Z',
      '2026-09-25T07:00:00.000Z',
      '2026-09-24',
    ],
    [
      '2018-11-04T12:00:00Z',
      'America/Sao_Paulo',
      '2018-11-04T03:00:00.000Z',
      '2018-11-05T02:00:00.000Z',
      '2018-11-04',
    ],
  ])('uses actual consecutive local midnights: %s %s', (now, zone, start, end, key) => {
    const bounds = localDayBounds(new Date(now), zone);
    expect(bounds.start.toISOString()).toBe(start);
    expect(bounds.end.toISOString()).toBe(end);
    expect(bounds.key).toBe(key);
  });
});

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
  it.each([
    ['2026-10-04T12:00:00Z', 'Australia/Sydney', '2026-10-03T14:00:00.000Z'],
    ['2026-04-05T12:00:00Z', 'Australia/Sydney', '2026-04-04T13:00:00.000Z'],
    ['2026-03-29T12:00:00Z', 'Europe/Warsaw', '2026-03-28T23:00:00.000Z'],
    ['2026-10-25T12:00:00Z', 'Europe/Warsaw', '2026-10-24T22:00:00.000Z'],
    ['2026-09-03T12:00:00Z', 'Asia/Kathmandu', '2026-09-02T18:15:00.000Z'],
  ])('resolves midnight across offset changes: %s %s', (now, zone, expected) => {
    expect(localDayStart(new Date(now), zone).toISOString()).toBe(expected);
  });
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
