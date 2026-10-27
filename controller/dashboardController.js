const POSSale = require("../models/POSSaleModel");
const Product = require("../models/Productmodel");
const asyncHandler = require("../helpers/asyncHandler");
const serialize = require("../helpers/serializers");
const { startOfDay, addDays } = require("../helpers/reportDateFilter");
const pipelines = require("../services/pipelines");
const { lastDaysTrend } = require("../services/statsService");

const LOW_STOCK = { status: "Active", $expr: { $lte: ["$quantity", "$reorderLevel"] } };

const dayTotals = async (start, end) => {
  const [row] = await POSSale.aggregate(pipelines.periodTotals(start, end));
  return { orders: row?.orders || 0, revenue: row?.revenue || 0, profit: row?.profit || 0 };
};

const bestSelling = (limit, since) => POSSale.aggregate(pipelines.bestSelling(limit, since));

module.exports.getDashboardSummary = asyncHandler(async (req, res) => {
  const canSeeCost = serialize.canSeeCost(req.user.role);
  const today = startOfDay();
  const tomorrow = addDays(today, 1);
  const yesterday = addDays(today, -1);

  const [
    todayT,
    yesterdayT,
    totalInvoices,
    [due],
    recentSales,
    lowStockProducts,
    [inv],
    best,
    trend,
  ] = await Promise.all([
    dayTotals(today, tomorrow),
    dayTotals(yesterday, today),
    POSSale.countDocuments({ status: "Completed" }),
    POSSale.aggregate(pipelines.outstandingDue()),
    POSSale.find({ status: "Completed" })
      .sort({ createdAt: -1 })
      .limit(6)
      .select("_id invoiceNumber customerName grandTotal paymentStatus createdAt")
      .lean(),
    Product.find(LOW_STOCK).select("name sku quantity reorderLevel sellingPrice unit").sort({ quantity: 1 }).limit(6).lean(),
    Product.aggregate(pipelines.inventorySnapshot()),
    bestSelling(5, addDays(today, -29)),
    lastDaysTrend(7),
  ]);

  const inventory = {
    totalProducts: inv?.totalProducts || 0,
    totalUnits: inv?.totalUnits || 0,
    retailValue: inv?.retailValue || 0,
    lowStock: inv?.lowStock || 0,
    outOfStock: inv?.outOfStock || 0,
    ...(canSeeCost ? { stockCost: inv?.stockCost || 0 } : {}),
  };

  res.json({
    success: true,
    dashboard: {
      cards: {
        todayOrders: todayT.orders,
        todayRevenue: todayT.revenue,
        todayProfit: canSeeCost ? todayT.profit : null,
        totalInvoices,
        totalDue: due?.due || 0,
        yesterdayOrders: yesterdayT.orders,
        yesterdayRevenue: yesterdayT.revenue,
        yesterdayProfit: canSeeCost ? yesterdayT.profit : null,
      },
      inventory,
      recentSales,
      lowStockProducts,
      bestSellingProducts: best,
      trend: canSeeCost ? trend : trend.map(({ profit, ...rest }) => rest),
    },
  });
});

module.exports.getDashboardTrend = asyncHandler(async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 90);
  const trend = await lastDaysTrend(days);
  const canSeeCost = serialize.canSeeCost(req.user.role);
  res.json({ success: true, trend: canSeeCost ? trend : trend.map(({ profit, ...r }) => r) });
});

module.exports.getRecentDashboardSales = asyncHandler(async (req, res) => {
  const sales = await POSSale.find({ status: "Completed" }).sort({ createdAt: -1 }).limit(10).lean();
  res.json({ success: true, sales: serialize.sales(sales, req.user.role) });
});

module.exports.getLowStockProducts = asyncHandler(async (req, res) => {
  const products = await Product.find(LOW_STOCK).sort({ quantity: 1 }).limit(50).populate("Category", "name").lean();
  res.json({ success: true, products: serialize.products(products, req.user.role) });
});

module.exports.getBestSellingProducts = asyncHandler(async (req, res) => {
  const days = parseInt(req.query.days, 10);
  const products = await bestSelling(10, days ? addDays(startOfDay(), -(days - 1)) : null);
  res.json({ success: true, products });
});
