const POSSale = require("../models/POSSaleModel");
const asyncHandler = require("../helpers/asyncHandler");
const { getDateFilter, resolveRange, startOfDay, addDays } = require("../helpers/reportDateFilter");
const { dailyTrend } = require("../services/statsService");
const pipelines = require("../services/pipelines");

const MAX_TREND_DAYS = 92;
const round = (n) => Math.round(n * 100) / 100;

const completed = (query) => ({ ...getDateFilter(query), status: "Completed" });

module.exports.getSummaryReport = asyncHandler(async (req, res) => {
  const match = completed(req.query);

  const range = resolveRange(req.query);
  const today = startOfDay();
  let trendStart = range ? range.start : addDays(today, -29);
  const trendEnd = range ? range.end : addDays(today, 1);
  if ((trendEnd - trendStart) / 86400000 > MAX_TREND_DAYS) trendStart = addDays(trendEnd, -MAX_TREND_DAYS);

  const [[totals], paymentStatus, paymentMethods, cancelledInvoices, trend] = await Promise.all([
    POSSale.aggregate(pipelines.summaryTotals(match)),
    POSSale.aggregate(pipelines.paymentStatuses(match)),
    POSSale.aggregate(pipelines.paymentMethods(match)),
    POSSale.countDocuments({ ...getDateFilter(req.query), status: "Cancelled" }),
    dailyTrend({ start: trendStart, end: trendEnd }),
  ]);

  const result = totals || { totalInvoices: 0, totalRevenue: 0, totalProfit: 0, totalPaid: 0, totalDue: 0, totalDiscount: 0, totalTax: 0 };
  const { _id, ...rest } = result;

  res.status(200).json({
    success: true,
    summary: {
      ...rest,
      averageInvoice: rest.totalInvoices ? round(rest.totalRevenue / rest.totalInvoices) : 0,
      cancelledInvoices,
      paymentStatus,
      paymentMethods,
      trend,
    },
  });
});

module.exports.getProductReport = asyncHandler(async (req, res) => {
  const report = await POSSale.aggregate(pipelines.productReport(completed(req.query)));
  res.json({ success: true, totalProducts: report.length, report });
});

module.exports.getCustomerReport = asyncHandler(async (req, res) => {
  const report = await POSSale.aggregate(pipelines.customerReport(completed(req.query)));
  res.json({ success: true, totalCustomers: report.length, report });
});

module.exports.getProfitReport = asyncHandler(async (req, res) => {
  const [row] = await POSSale.aggregate(pipelines.profitReport(completed(req.query)));
  const r = row || { totalInvoices: 0, grossRevenue: 0, totalDiscount: 0, totalTax: 0, grandTotal: 0, totalCost: 0 };

  // Net revenue excludes tax (money collected for the government is not income).
  const netRevenue = round(r.grossRevenue - r.totalDiscount);
  const grossProfit = round(netRevenue - r.totalCost);

  res.json({
    success: true,
    report: {
      totalInvoices: r.totalInvoices,
      grossRevenue: round(r.grossRevenue),
      totalDiscount: round(r.totalDiscount),
      totalTax: round(r.totalTax),
      grandTotal: round(r.grandTotal),
      netRevenue,
      totalCost: round(r.totalCost),
      grossProfit,
      profitPercentage: netRevenue === 0 ? 0 : round((grossProfit / netRevenue) * 100),
    },
  });
});
