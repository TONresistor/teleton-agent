/**
 * Parse natural-language schedule descriptions into a future Unix timestamp (seconds).
 *
 * Supports:
 *  - ISO 8601 with offset or 'Z'  (already handled by callers, returned as-is)
 *  - "21:00", "09:30"            -> today at that time (or tomorrow if already passed)
 *  - "завтра 09:00", "tomorrow 09:00", "завтра" -> tomorrow at time (or 00:00)
 *  - "послезавтра 09:00", "day after tomorrow" -> two days from now
 *  - "в 21:00", "at 21:00"       -> optional leading "at/в"
 *  - "21:00 GMT+3"               -> time of day in an explicit numeric offset
 *  - "завтра 09:00 GMT+3", "tomorrow 9:00 UTC" -> day keyword with timezone suffix
 *  - "через 2 часа", "in 2 hours", "через 30 минут", "in 30 minutes" -> relative
 *
 * @returns Unix timestamp (seconds) or null if unparseable.
 */
export function parseNaturalSchedule(value: string, nowMs = Date.now()): number | null {
  const input = value.trim();
  if (!input) return null;

  // Absolute numeric timestamps and full ISO strings are handled by the caller,
  // but accept them here too so the parser is self-contained.
  const asNumber = Number(input);
  if (Number.isFinite(asNumber) && asNumber > 1e9) return Math.floor(asNumber);

  const parsedIso = Date.parse(input);
  if (Number.isFinite(parsedIso)) return Math.floor(parsedIso / 1000);

  const lower = input.toLowerCase();

  // Numeric UTC offset suffix: "GMT+3", "GMT+03:00", "UTC+3", "+3". Stored as
  // a difference to apply relative to the local interpretation of the wall-clock.
  let offsetMinutes = 0;
  let hasOffset = false;
  const offsetMatch = lower.match(/(?:gmt|utc)?\s*([+-]\d{1,2})(?::(\d{2}))?\s*$/);
  if (offsetMatch) {
    const hours = Number(offsetMatch[1]);
    const minutes = offsetMatch[2] ? Number(offsetMatch[2]) : 0;
    if (Number.isFinite(hours)) {
      offsetMinutes = (hours >= 0 ? 1 : -1) * (Math.abs(hours) * 60 + minutes);
      hasOffset = true;
    }
  } else if (/\b(?:gmt|utc)\s*$/i.test(lower)) {
    // Bare "GMT" / "UTC" (no sign) is an explicit +0 offset.
    offsetMinutes = 0;
    hasOffset = true;
  }

  // Relative: "через 2 часа", "через 30 минут", "in 2 hours", "in 30 minutes"
  const relativeMatch = lower.match(
    /^(?:через|in|after)\s+(\d+)\s*(?:час|минут|мин|hour|hours|minute|minutes|sec|seconds|сек|секунд)/
  );
  if (relativeMatch) {
    const amount = Number(relativeMatch[1]);
    if (!Number.isFinite(amount)) return null;
    if (/час|hour/.test(relativeMatch[0])) return Math.floor((nowMs + amount * 3_600_000) / 1000);
    if (/сек|sec/.test(relativeMatch[0])) return Math.floor((nowMs + amount * 1_000) / 1000);
    return Math.floor((nowMs + amount * 60_000) / 1000);
  }

  // Day keyword: "завтра", "tomorrow", "послезавтра", "day after tomorrow"
  let dayOffset = 0;
  if (/послезавтра|day after tomorrow/.test(lower)) dayOffset = 2;
  else if (/завтра|tomorrow/.test(lower)) dayOffset = 1;

  // Time of day anywhere in the string: "21:00", "в 21:00", "завтра 09:30", "tomorrow 9:30"
  const timeMatch = lower.match(/\b(\d{1,2})[:.](\d{2})\b/);
  if (timeMatch || dayOffset > 0) {
    const base = new Date(nowMs);
    const hour = timeMatch ? Number(timeMatch[1]) : 0;
    const minute = timeMatch ? Number(timeMatch[2]) : 0;

    const target = new Date(
      base.getFullYear(),
      base.getMonth(),
      base.getDate() + dayOffset,
      Number.isFinite(hour) ? hour : 0,
      Number.isFinite(minute) ? minute : 0,
      0,
      0
    );

    // If no explicit day keyword and the time already passed today, schedule tomorrow.
    if (dayOffset === 0 && target.getTime() <= nowMs) {
      target.setDate(target.getDate() + 1);
    }

    // If an explicit offset was given (e.g. "21:00 GMT+3", "завтра 09:00 UTC"),
    // shift the local wall-clock interpretation so the stored timestamp matches
    // that zone.
    if (hasOffset) {
      const serverOffsetMinutes = -target.getTimezoneOffset(); // +3 -> +180
      const deltaMinutes = serverOffsetMinutes - offsetMinutes;
      target.setTime(target.getTime() + deltaMinutes * 60_000);
    }

    return Math.floor(target.getTime() / 1000);
  }

  return null;
}
