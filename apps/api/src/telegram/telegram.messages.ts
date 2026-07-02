/**
 * Pure message composers for the Telegram digest + nudge. HTML parse mode
 * (Telegram's HTML subset: <b>, <i>, no block tags — newlines are literal).
 */

const KIND_FALLBACK_MINUTES: Record<string, number> = { concept: 2, code: 10, problem: 30 };

export interface DigestData {
  date: Date;
  timezone: string;
  dueByKind: { concept: number; code: number; problem: number };
  dueCount: number;
  estMinutes: number;
  overdueTopics: number;
  streak: number;
  nextUpTitle: string | null;
}

export interface NudgeData {
  streak: number;
  dueCount: number;
  estMinutes: number;
}

export function estimateMinutes(
  cards: { promptKind: string; estimatedMinutes: number | null }[],
): number {
  return cards.reduce(
    (sum, c) => sum + (c.estimatedMinutes ?? KIND_FALLBACK_MINUTES[c.promptKind] ?? 0),
    0,
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function composeDigest(d: DigestData): string {
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: d.timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(d.date);
  const lines = [`🌄 <b>Terrain — ${day}</b>`];
  if (d.dueCount === 0) {
    lines.push(`All clear — nothing due today. Streak ${d.streak} 🔥`);
  } else {
    const kinds = [
      d.dueByKind.concept > 0 ? `${d.dueByKind.concept} concept` : null,
      d.dueByKind.code > 0 ? `${d.dueByKind.code} code` : null,
      d.dueByKind.problem > 0 ? `${d.dueByKind.problem} problem` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    lines.push(`Due: ${d.dueCount} cards (${kinds}) · ~${d.estMinutes} min`);
    lines.push(`Overdue topics: ${d.overdueTopics} · Streak: ${d.streak} 🔥`);
  }
  if (d.nextUpTitle) lines.push(`Next up: ${escapeHtml(d.nextUpTitle)}`);
  return lines.join('\n');
}

export function composeNudge(d: NudgeData): string {
  return [
    `⚠️ Streak (${d.streak}) at risk — nothing logged today.`,
    `${d.dueCount} cards due · ~${d.estMinutes} min. One review keeps the day.`,
  ].join('\n');
}
