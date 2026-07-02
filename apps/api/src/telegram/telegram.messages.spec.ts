import { composeDigest, composeNudge, estimateMinutes } from './telegram.messages';

describe('estimateMinutes', () => {
  it('uses per-kind fallbacks when estimatedMinutes is null', () => {
    expect(
      estimateMinutes([
        { promptKind: 'concept', estimatedMinutes: null },
        { promptKind: 'code', estimatedMinutes: null },
        { promptKind: 'problem', estimatedMinutes: null },
      ]),
    ).toBe(2 + 10 + 30);
  });

  it('prefers explicit estimatedMinutes and handles empty input', () => {
    expect(estimateMinutes([{ promptKind: 'problem', estimatedMinutes: 45 }])).toBe(45);
    expect(estimateMinutes([])).toBe(0);
  });
});

describe('composeDigest', () => {
  const base = {
    date: new Date('2026-07-02T06:00:00Z'),
    timezone: 'UTC',
    dueByKind: { concept: 3, code: 2, problem: 2 },
    dueCount: 7,
    estMinutes: 40,
    overdueTopics: 2,
    streak: 12,
    nextUpTitle: 'Interval DP',
  };

  it('renders the full digest', () => {
    const html = composeDigest(base);
    expect(html).toContain('Thu, Jul 2');
    expect(html).toContain('Due: 7 cards (3 concept · 2 code · 2 problem) · ~40 min');
    expect(html).toContain('Overdue topics: 2 · Streak: 12 🔥');
    expect(html).toContain('Next up: Interval DP');
  });

  it('renders the all-clear one-liner when nothing is due', () => {
    const html = composeDigest({
      ...base,
      dueByKind: { concept: 0, code: 0, problem: 0 },
      dueCount: 0,
      estMinutes: 0,
      overdueTopics: 0,
    });
    expect(html).toContain('All clear — nothing due today. Streak 12 🔥');
    expect(html).not.toContain('Due:');
  });

  it('omits the next-up line when there is none and escapes HTML in titles', () => {
    expect(composeDigest({ ...base, nextUpTitle: null })).not.toContain('Next up');
    expect(composeDigest({ ...base, nextUpTitle: 'a < b & c' })).toContain('a &lt; b &amp; c');
  });

  it('formats the date in the user timezone', () => {
    // 23:30 UTC on Jul 2 is already Jul 3 in Kyiv (UTC+3 in summer)
    const html = composeDigest({
      ...base,
      date: new Date('2026-07-02T23:30:00Z'),
      timezone: 'Europe/Kyiv',
    });
    expect(html).toContain('Jul 3');
  });
});

describe('composeNudge', () => {
  it('renders streak, due count and estimate', () => {
    const html = composeNudge({ streak: 12, dueCount: 5, estMinutes: 15 });
    expect(html).toContain('Streak (12) at risk — nothing logged today.');
    expect(html).toContain('5 cards due · ~15 min. One review keeps the day.');
  });
});
