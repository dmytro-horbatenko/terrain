import type { TopicStatus } from '../api/types';

export const STATUS_META: Record<TopicStatus, { label: string; glyph: string; color: string }> = {
  planned: { label: 'Planned', glyph: '○', color: 'var(--st-planned)' },
  active: { label: 'Active', glyph: '●', color: 'var(--st-active)' },
  mastered: { label: 'Mastered', glyph: '✓', color: 'var(--st-mastered)' },
  archived: { label: 'Archived', glyph: '▢', color: 'var(--st-archived)' },
};

export const BLOCKED_COLOR = 'var(--st-blocked)';

/** Effective display color: a blocked topic reads red regardless of status. */
export function topicColor(status: TopicStatus, blocked?: boolean): string {
  return blocked ? BLOCKED_COLOR : STATUS_META[status].color;
}

export function topicGlyph(status: TopicStatus, blocked?: boolean): string {
  return blocked ? '✗' : STATUS_META[status].glyph;
}

/** A translucent tint of any CSS color, for badge/chip backgrounds. */
export function tint(color: string, amount = 15): string {
  return `color-mix(in srgb, ${color} ${amount}%, white)`;
}
