const POSSale = require("../models/POSSaleModel");
const { timezone } = require("../config/env");
const { startOfDay, addDays } = require("../helpers/reportDateFilter");

/**
 * Cost of goods sold for an invoice, computed from the item snapshots.
 * Profit is always `(subtotal − discount) − cost` – tax is never profit, and we do not rely on the
 * stored `totalProfit` so invoices created by older versions are reported consistently too.
 */
const { COST_EXPR, PROFIT_EXPR, dailyTrend: dailyTrendPipeline } = require("./pipelines");

const dayKey = (date, tz = timezone) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(date);

/**
 * Per-day totals between [start, end), zero-filled so charts never have gaps.
 * Day boundaries follow APP_TIMEZONE.
 */
const dailyTrend = async ({ start, end, extraMatch = {} }) => {
  const rows = await POSSale.aggregate(dailyTrendPipeline({ start, end, timezone, extraMatch }));
  const map = new Map(rows.map((r) => [r._id, r]));

  const out = [];
  for (let day = start, guard = 0; day < end && guard < 400; day = addDays(day, 1), guard++) {
    const key = dayKey(day);
    const r = map.get(key);
    out.push({
      date: key,
      orders: r?.orders || 0,
      revenue: r ? Math.round(r.revenue * 100) / 100 : 0,
      profit: r ? Math.round(r.profit * 100) / 100 : 0,
    });
  }
  return out;
};

/** Trend for the last `days` days including today. */
const lastDaysTrend = (days = 7, now = new Date()) => {
  const today = startOfDay(now);
  return dailyTrend({ start: addDays(today, -(days - 1)), end: addDays(today, 1) });
};

module.exports = { COST_EXPR, PROFIT_EXPR, dailyTrend, lastDaysTrend, dayKey };
