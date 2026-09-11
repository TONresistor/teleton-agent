import { describe, expect, it } from "vitest";
import { parseNaturalSchedule } from "../parse-natural-time.js";

// Local timezone is used by the parser (matches the owner's server), so tests
// build expected values through the same local-time Date construction.
function localTs(year: number, month: number, day: number, hour: number, minute: number): number {
  return Math.floor(new Date(year, month, day, hour, minute, 0, 0).getTime() / 1000);
}

describe("parseNaturalSchedule", () => {
  const now = new Date();
  const NOW = now.getTime();
  const today = {
    y: now.getFullYear(),
    m: now.getMonth(),
    d: now.getDate(),
  };

  it("returns null for empty or unparseable input", () => {
    expect(parseNaturalSchedule("")).toBeNull();
    expect(parseNaturalSchedule("asdf qwer")).toBeNull();
  });

  it("accepts full ISO strings and numeric timestamps", () => {
    expect(parseNaturalSchedule("2026-08-16T12:00:00Z", NOW)).toBe(
      Math.floor(Date.parse("2026-08-16T12:00:00Z") / 1000)
    );
    expect(parseNaturalSchedule("1787000000", NOW)).toBe(1787000000);
  });

  it("parses bare time of day as today or tomorrow", () => {
    // A time earlier than now -> tomorrow
    const earlier = localTs(today.y, today.m, today.d, 0, 0);
    expect(parseNaturalSchedule("00:00", NOW)).toBe(
      earlier <= Math.floor(NOW / 1000) ? localTs(today.y, today.m, today.d + 1, 0, 0) : earlier
    );
  });

  it("parses 'at'/'в' prefix", () => {
    // 21:00 is almost always after now
    const expected = localTs(today.y, today.m, today.d, 21, 0);
    expect(parseNaturalSchedule("в 21:00", NOW)).toBe(expected);
    expect(parseNaturalSchedule("at 21:00", NOW)).toBe(expected);
  });

  it("parses tomorrow / завтра with optional time", () => {
    expect(parseNaturalSchedule("завтра 09:00", NOW)).toBe(
      localTs(today.y, today.m, today.d + 1, 9, 0)
    );
    expect(parseNaturalSchedule("tomorrow 14:30", NOW)).toBe(
      localTs(today.y, today.m, today.d + 1, 14, 30)
    );
  });

  it("parses time of day with explicit GMT/UTC offset", () => {
    // "21:00 GMT+3" should equal local 21:00 when the server itself is GMT+3.
    const serverOffset = -new Date(today.y, today.m, today.d).getTimezoneOffset(); // minutes
    const offsetAdjusted =
      Math.floor(localTs(today.y, today.m, today.d, 21, 0)) + Math.floor((serverOffset - 180) * 60);
    expect(parseNaturalSchedule("21:00 GMT+3", NOW)).toBe(offsetAdjusted);
    expect(parseNaturalSchedule("завтра 09:00 UTC", NOW)).toBe(
      Math.floor(localTs(today.y, today.m, today.d + 1, 9, 0)) + Math.floor(serverOffset * 60)
    );
  });

  it("parses relative Russian and English delays", () => {
    expect(parseNaturalSchedule("через 2 часа", NOW)).toBe(
      Math.floor((NOW + 2 * 3_600_000) / 1000)
    );
    expect(parseNaturalSchedule("через 30 минут", NOW)).toBe(
      Math.floor((NOW + 30 * 60_000) / 1000)
    );
    expect(parseNaturalSchedule("in 3 hours", NOW)).toBe(Math.floor((NOW + 3 * 3_600_000) / 1000));
    expect(parseNaturalSchedule("in 45 minutes", NOW)).toBe(Math.floor((NOW + 45 * 60_000) / 1000));
  });
});
