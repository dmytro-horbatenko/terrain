/**
 * Timezone math via Intl only — no date library. Known DST caveat (accepted
 * in the spec): during the one repeated/skipped local hour a year, a digest
 * can double-fire or skip once; no send-state is tracked to compensate.
 */

export function localHour(now: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hourCycle: 'h23',
  }).format(now);
  return Number(hour);
}

/** Offset of `timeZone` from UTC at instant `at`, in ms (UTC+3 -> +3h). */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - at.getTime();
}

/** First midnight (or first valid instant when midnight is skipped) of this local day. */
export function localDayStart(now: Date, timeZone: string): Date {
  return localDateStart(localDateKey(now, timeZone), timeZone);
}

/** A calendar label, never an instant or a server-local date. */
export function localDateKey(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
}

export function shiftDateKey(key: string, days: number): string {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function localDayBounds(now: Date, timeZone: string) {
  const key = localDateKey(now, timeZone);
  return {
    key,
    start: localDateStart(key, timeZone),
    end: localDateStart(shiftDateKey(key, 1), timeZone),
  };
}

export function localDateStart(dateStr: string, timeZone: string): Date {
  const guess = new Date(`${dateStr}T00:00:00Z`);
  // Try offsets on both sides of a transition, then verify at the actual instant.
  const candidates = [-1, 0, 1].map(
    (day) =>
      new Date(
        guess.getTime() - zoneOffsetMs(new Date(guess.getTime() + day * 86_400_000), timeZone),
      ),
  );
  const valid = candidates.filter(
    (candidate) => candidate.getTime() + zoneOffsetMs(candidate, timeZone) === guess.getTime(),
  );
  return new Date(
    valid.length
      ? Math.min(...valid.map((d) => d.getTime()))
      : Math.max(...candidates.map((d) => d.getTime())),
  );
}
