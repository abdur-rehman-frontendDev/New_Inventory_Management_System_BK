/**
 * Every MongoDB aggregation pipeline used by the dashboard, reports and invoice list lives here, as plain
 * functions that return pipeline arrays. Keeping them separate makes them easy to read and lets the tests run
 * the exact same pipelines in an independent in-memory engine.
 *
 * Profit is always (subtotal − discount) − cost of goods; tax is never profit.
 */
const COST_EXPR = {
  $sum: { $map: { input: "$items", as: "i", in: { $multiply: ["$$i.purchasePrice", "$$i.quantity"] } } },
};
const PROFIT_EXPR = { $subtract: [{ $subtract: ["$subtotal", "$discount"] }, COST_EXPR] };

const completed = (match = {}) => ({ ...match, status: "Completed" });

/** Invoice-list header stats for the current filter. */
const invoiceStats = (filter) => [
  { $match: completed(filter) },
  { $group: { _id: null, invoices: { $sum: 1 }, revenue: { $sum: "$grandTotal" }, due: { $sum: "$dueAmount" }, paid: { $sum: "$paidAmount" } } },
];

/** Totals for one day (dashboard cards, "today" endpoint). */
const periodTotals = (start, end) => [
  { $match: { status: "Completed", createdAt: { $gte: start, $lt: end } } },
  { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: "$grandTotal" }, profit: { $sum: PROFIT_EXPR } } },
];

const outstandingDue = () => [{ $match: { status: "Completed" } }, { $group: { _id: null, due: { $sum: "$dueAmount" } } }];

const bestSelling = (limit, since) => [
  { $match: { status: "Completed", ...(since ? { createdAt: { $gte: since } } : {}) } },
  { $unwind: "$items" },
  {
    $group: {
      _id: "$items.product",
      name: { $first: "$items.name" },
      sku: { $first: "$items.sku" },
      totalSold: { $sum: "$items.quantity" },
      revenue: { $sum: "$items.lineTotal" },
    },
  },
  { $sort: { totalSold: -1 } },
  { $limit: limit },
];

const inventorySnapshot = () => [
  {
    $group: {
      _id: null,
      totalProducts: { $sum: 1 },
      totalUnits: { $sum: "$quantity" },
      stockCost: { $sum: { $multiply: ["$purchasePrice", "$quantity"] } },
      retailValue: { $sum: { $multiply: ["$sellingPrice", "$quantity"] } },
      lowStock: { $sum: { $cond: [{ $and: [{ $eq: ["$status", "Active"] }, { $gt: ["$quantity", 0] }, { $lte: ["$quantity", "$reorderLevel"] }] }, 1, 0] } },
      outOfStock: { $sum: { $cond: [{ $and: [{ $eq: ["$status", "Active"] }, { $lte: ["$quantity", 0] }] }, 1, 0] } },
    },
  },
];

/** Per-day totals; days are cut in `timezone` (Olson name). */
const dailyTrend = ({ start, end, timezone, extraMatch = {} }) => [
  { $match: { status: "Completed", createdAt: { $gte: start, $lt: end }, ...extraMatch } },
  {
    $group: {
      _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone } },
      orders: { $sum: 1 },
      revenue: { $sum: "$grandTotal" },
      profit: { $sum: PROFIT_EXPR },
    },
  },
];

const summaryTotals = (match) => [
  { $match: match },
  {
    $group: {
      _id: null,
      totalInvoices: { $sum: 1 },
      totalRevenue: { $sum: "$grandTotal" },
      totalProfit: { $sum: PROFIT_EXPR },
      totalPaid: { $sum: "$paidAmount" },
      totalDue: { $sum: "$dueAmount" },
      totalDiscount: { $sum: "$discount" },
      totalTax: { $sum: "$tax" },
    },
  },
];
const paymentStatuses = (match) => [{ $match: match }, { $group: { _id: "$paymentStatus", total: { $sum: 1 } } }];
const paymentMethods = (match) => [
  { $match: match },
  { $group: { _id: "$paymentMethod", count: { $sum: 1 }, total: { $sum: "$paidAmount" } } },
  { $sort: { total: -1 } },
];

const productReport = (match) => [
  { $match: match },
  { $unwind: "$items" },
  {
    $group: {
      _id: "$items.product",
      productName: { $first: "$items.name" },
      sku: { $first: "$items.sku" },
      totalSold: { $sum: "$items.quantity" },
      revenue: { $sum: "$items.lineTotal" },
      totalCost: { $sum: { $multiply: ["$items.purchasePrice", "$items.quantity"] } },
    },
  },
  {
    $addFields: {
      profit: { $subtract: ["$revenue", "$totalCost"] },
      averagePrice: { $cond: [{ $eq: ["$totalSold", 0] }, 0, { $divide: ["$revenue", "$totalSold"] }] },
    },
  },
  { $sort: { totalSold: -1 } },
  { $limit: 500 },
];

const customerReport = (match) => [
  { $match: match },
  {
    $group: {
      // Same phone = same customer; without a phone fall back to the name.
      _id: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ["$customerPhone", ""] } }, 0] }, "$customerPhone", { $toLower: "$customerName" }] },
      customerName: { $first: "$customerName" },
      customerPhone: { $first: "$customerPhone" },
      invoices: { $sum: 1 },
      totalPurchase: { $sum: "$grandTotal" },
      totalPaid: { $sum: "$paidAmount" },
      totalDue: { $sum: "$dueAmount" },
      totalProfit: { $sum: PROFIT_EXPR },
      lastPurchase: { $max: "$createdAt" },
    },
  },
  { $sort: { totalPurchase: -1 } },
  { $limit: 500 },
];

const profitReport = (match) => [
  { $match: match },
  {
    $group: {
      _id: null,
      totalInvoices: { $sum: 1 },
      grossRevenue: { $sum: "$subtotal" },
      totalDiscount: { $sum: "$discount" },
      totalTax: { $sum: "$tax" },
      grandTotal: { $sum: "$grandTotal" },
      totalCost: { $sum: COST_EXPR },
    },
  },
];

module.exports = {
  COST_EXPR, PROFIT_EXPR, invoiceStats, periodTotals, outstandingDue, bestSelling, inventorySnapshot, dailyTrend,
  summaryTotals, paymentStatuses, paymentMethods, productReport, customerReport, profitReport,
};
