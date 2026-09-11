/**
 * Time-of-day awareness for human-like behavior variability.
 *
 * Features:
 * - Morning (6-10): faster replies, shorter messages, higher energy
 * - Day (10-18): normal baseline
 * - Evening (18-23): slower, more thoughtful, longer messages
 * - Night (23-6): quiet hours — minimal activity, short replies
 * - Configurable quiet hours with override
 */

export interface TimeOfDayConfig {
  enabled: boolean;
  quietHoursStart: number; // 0-23
  quietHoursEnd: number; // 0-23
  /** Override timezone offset in minutes from UTC (e.g. Moscow winter = 180) */
  timezoneOffsetMinutes: number;
}

const DEFAULT_CONFIG: TimeOfDayConfig = {
  enabled: true,
  quietHoursStart: 23,
  quietHoursEnd: 6,
  timezoneOffsetMinutes: 180, // Default Moscow time (UTC+3)
};

export type TimePeriod = "night" | "morning" | "day" | "evening";

export interface TimeOfDayFactors {
  period: TimePeriod;
  /** Typing speed multiplier (lower = slower) */
  typingSpeedFactor: number;
  /** Reply probability multiplier */
  replyProbabilityFactor: number;
  /** Max response length suggestion */
  maxLengthSuggestion: number;
  /** Whether we're in quiet hours */
  isQuietHours: boolean;
}

export function getTimeOfDayConfig(overrides?: Partial<TimeOfDayConfig>): TimeOfDayConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

/**
 * Get current local hour (0-23) based on configured offset.
 */
export function getLocalHour(config: TimeOfDayConfig): number {
  const now = new Date();
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const localMinutes = (utcMinutes + config.timezoneOffsetMinutes + 1440) % 1440;
  return Math.floor(localMinutes / 60);
}

/**
 * Get the current time period based on local hour.
 */
export function getTimePeriod(config: TimeOfDayConfig): TimePeriod {
  const hour = getLocalHour(config);

  if (hour >= config.quietHoursStart || hour < config.quietHoursEnd) {
    return "night";
  }
  if (hour >= 6 && hour < 10) {
    return "morning";
  }
  if (hour >= 10 && hour < 18) {
    return "day";
  }
  return "evening";
}

/**
 * Get behavioral factors for the current time.
 */
export function getTimeFactors(config: TimeOfDayConfig): TimeOfDayFactors {
  const period = getTimePeriod(config);

  switch (period) {
    case "night":
      return {
        period,
        typingSpeedFactor: 0.5,
        replyProbabilityFactor: 0.3,
        maxLengthSuggestion: 200,
        isQuietHours: true,
      };
    case "morning":
      return {
        period,
        typingSpeedFactor: 1.3,
        replyProbabilityFactor: 0.9,
        maxLengthSuggestion: 500,
        isQuietHours: false,
      };
    case "day":
      return {
        period,
        typingSpeedFactor: 1.0,
        replyProbabilityFactor: 1.0,
        maxLengthSuggestion: 2000,
        isQuietHours: false,
      };
    case "evening":
      return {
        period,
        typingSpeedFactor: 0.8,
        replyProbabilityFactor: 1.0,
        maxLengthSuggestion: 3000,
        isQuietHours: false,
      };
  }
}

/**
 * Whether it is currently quiet hours under the given config.
 * Convenience wrapper so callers don't need to pull the flag out of
 * getTimeFactors() themselves.
 */
export function isQuietHours(config: TimeOfDayConfig): boolean {
  return getTimeFactors(config).isQuietHours;
}

/**
 * Get a human-readable description of current time context.
 */
export function getTimeContextDescription(config: TimeOfDayConfig): string {
  const hour = getLocalHour(config);
  const period = getTimePeriod(config);

  const periodNames: Record<TimePeriod, string> = {
    night: "night (quiet hours)",
    morning: "morning",
    day: "afternoon",
    evening: "evening",
  };

  return `local_time: ${hour}:00, period: ${periodNames[period]}`;
}
