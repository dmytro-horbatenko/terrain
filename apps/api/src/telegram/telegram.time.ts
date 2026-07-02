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

/** UTC instant of the current local midnight in `timeZone`. */
export function localDayStart(now: Date, timeZone: string): Date {
  const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone }).format(now); // YYYY-MM-DD
  const guess = new Date(`${dateStr}T00:00:00Z`);
  return new Date(guess.getTime() - zoneOffsetMs(guess, timeZone));
}
