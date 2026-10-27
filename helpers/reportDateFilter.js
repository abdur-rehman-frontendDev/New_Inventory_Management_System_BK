/**
 * Timezone-aware date range helpers.
 *
 * The old implementation used the *server's* local time. On Vercel that is UTC, so for a shop in
 * Pakistan (UTC+5) "today" started at 5 AM local time. Everything here is calculated in
 * APP_TIMEZONE (default Asia/Karachi) using only the built-in Intl API.
 */
const { timezone: DEFAULT_TZ } = require("../config/env");

const DAY = 24 * 60 * 60 * 1000;

/** Offset (ms) of `tz` from UTC at the given instant. */
const tzOffsetMs = (date, tz) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUTC - (date.getTime() - date.getMilliseconds());
};

/** Instant of 00:00:00.000 (in tz) of the day containing `date`. */
const startOfDay = (date = new Date(), tz = DEFAULT_TZ) => {
  const local = new Date(date.getTime() + tzOffsetMs(date, tz));
  const localMidnightAsUTC = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const guess = new Date(localMidnightAsUTC - tzOffsetMs(date, tz));
  return new Date(localMidnightAsUTC - tzOffsetMs(guess, tz));
};

/** Start of the day that is `n` calendar days after the day starting at `start`. */
const addDays = (start, n, tz = DEFAULT_TZ) => startOfDay(new Date(start.getTime() + n * DAY + DAY / 2), tz);

/** Parse "YYYY-MM-DD" (or an ISO string) as a calendar day in tz. */
const parseDay = (value, tz = DEFAULT_TZ) => {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (m) {
    const noonUTC = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
    return startOfDay(noonUTC, tz);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : startOfDay(d, tz);
};

/**
 * Resolve a report period to a half-open interval [start, end).
 * Returns null for "all time".
 * Accepts both the legacy `from`/`to` and the UI's `startDate`/`endDate` parameter names.
 */
const resolveRange = (query = {}, { tz = DEFAULT_TZ, now = new Date() } = {}) => {
  const period = query.period;
  const today = startOfDay(now, tz);
  const tomorrow = addDays(today, 1, tz);

  switch (period) {
    case "today":
      return { start: today, end: tomorrow };
    case "yesterday":
      return { start: addDays(today, -1, tz), end: today };
    case "week": {
      // Monday start
      const weekday = new Date(today.getTime() + tzOffsetMs(today, tz)).getUTCDay(); // 0 = Sunday
      const diff = weekday === 0 ? 6 : weekday - 1;
      return { start: addDays(today, -diff, tz), end: tomorrow };
    }
    case "month": {
      const local = new Date(now.getTime() + tzOffsetMs(now, tz));
      const first = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1, 12));
      return { start: startOfDay(first, tz), end: tomorrow };
    }
    case "last7":
      return { start: addDays(today, -6, tz), end: tomorrow };
    case "last30":
      return { start: addDays(today, -29, tz), end: tomorrow };
    case "year": {
      const local = new Date(now.getTime() + tzOffsetMs(now, tz));
      const first = new Date(Date.UTC(local.getUTCFullYear(), 0, 1, 12));
      return { start: startOfDay(first, tz), end: tomorrow };
    }
    default:
      break;
  }

  const from = parseDay(query.from || query.startDate, tz);
  const to = parseDay(query.to || query.endDate, tz);

  if (from || to) {
    let start = from || to;
    let endDay = to || from;
    if (start > endDay) [start, endDay] = [endDay, start];
    return { start, end: addDays(endDay, 1, tz) };
  }

  return null;
};

/** Mongo `createdAt` filter for a query string (empty object = all time). Backwards compatible name. */
const getDateFilter = (query = {}, opts) => {
  const range = resolveRange(query, opts);
  return range ? { createdAt: { $gte: range.start, $lt: range.end } } : {};
};

module.exports = { getDateFilter, resolveRange, startOfDay, addDays, parseDay, tzOffsetMs };
module.exports.getDateFilter = getDateFilter;
