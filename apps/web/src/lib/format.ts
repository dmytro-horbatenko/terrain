const DAY = 86_400_000;

export function formatDate(
  iso: string | null | undefined,
  opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' },
  timeZone = 'UTC',
): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, {
    ...opts,
    timeZone: /^\d{4}-\d{2}-\d{2}$/.test(iso) ? 'UTC' : timeZone,
  });
}

export function formatDateTime(iso: string | null | undefined, timeZone = 'UTC'): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export interface DueInfo {
  text: string;
  overdue: boolean;
  quiet: boolean;
  days: number | null;
}

/** Human due label relative to today in the learner's saved timezone. */
export function dueLabel(
  nextReviewAt: string | null | undefined,
  timeZone = 'UTC',
  now = new Date(),
): DueInfo {
  if (!nextReviewAt || Number.isNaN(new Date(nextReviewAt).getTime()))
    return { text: 'not scheduled', overdue: false, quiet: true, days: null };
  const dates = new Intl.DateTimeFormat('en-CA', { timeZone });
  const nextKey = /^\d{4}-\d{2}-\d{2}$/.test(nextReviewAt)
    ? nextReviewAt
    : dates.format(new Date(nextReviewAt));
  const days = (Date.parse(nextKey) - Date.parse(dates.format(now))) / DAY;
  if (days < 0) return { text: `overdue ${-days}d`, overdue: true, quiet: false, days };
  if (days === 0) return { text: 'due today', overdue: false, quiet: false, days };
  if (days === 1) return { text: 'due tomorrow', overdue: false, quiet: false, days };
  return { text: `in ${days}d`, overdue: false, quiet: false, days };
}

export function isUrl(s: string | null | undefined): boolean {
  return !!s && /^https?:\/\//i.test(s);
}

/**
 * Resolve a topic `noteRef` to a clickable href, or null when it isn't linkable:
 * - a plain URL → itself;
 * - an Obsidian-style ref ("Obsidian: Note", "obsidian > Note", or a bare name)
 *   → an `obsidian://open` deep link, *only* when a vault is configured;
 * - a OneNote section path ("A > B > C") → null (not deep-linkable).
 */
export function noteRefHref(
  noteRef: string | null | undefined,
  obsidianVault?: string | null,
): string | null {
  if (!noteRef) return null;
  if (isUrl(noteRef)) return noteRef;
  if (!obsidianVault) return null;
  const m = /^obsidian\s*[:>]\s*(.+)$/i.exec(noteRef.trim());
  const file = (m ? m[1] : noteRef).trim();
  // A "A > B > C" path with no obsidian prefix reads as a OneNote section path.
  if (!m && file.includes('>')) return null;
  return `obsidian://open?vault=${encodeURIComponent(obsidianVault)}&file=${encodeURIComponent(file)}`;
}
