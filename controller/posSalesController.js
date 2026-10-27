const POSSale = require("../models/POSSaleModel");
const AppError = require("../helpers/AppError");
const asyncHandler = require("../helpers/asyncHandler");
const paginate = require("../helpers/pagination");
const { contains } = require("../helpers/regex");
const { getDateFilter, startOfDay, addDays } = require("../helpers/reportDateFilter");
const serialize = require("../helpers/serializers");
const { createSale, cancelSale } = require("../services/saleService");
const pipelines = require("../services/pipelines");

module.exports.createPOSSale = asyncHandler(async (req, res) => {
  const sale = await createSale({ payload: req.body, user: req.user, ip: req.ip });
  res.status(201).json({ success: true, message: "Sale completed", sale: serialize.sale(sale, req.user.role) });
});

/** GET /  /all  /search – one paginated, filterable list. */
module.exports.getAllPOSSales = asyncHandler(async (req, res) => {
  const { page, limit, query, q, status, paymentStatus, paymentMethod } = req.query;
  const search = (query || q || "").toString().trim();

  const filter = { ...getDateFilter(req.query) };
  if (status) filter.status = status;
  if (paymentStatus) filter.paymentStatus = paymentStatus;
  if (paymentMethod) filter.paymentMethod = paymentMethod;
  if (search) {
    filter.$or = [{ invoiceNumber: contains(search) }, { customerName: contains(search) }, { customerPhone: contains(search) }];
  }

  const [result, [stats]] = await Promise.all([
    paginate({ model: POSSale, page, limit: limit || 15, query: filter, sort: { createdAt: -1 }, populate: { path: "createdBy", select: "name" } }),
    POSSale.aggregate(pipelines.invoiceStats(filter)),
  ]);

  const sales = serialize.sales(result.data, req.user.role);
  res.status(200).json({
    success: true,
    totalSales: result.pagination.totalRecords,
    sales,
    pagination: result.pagination,
    stats: stats || { invoices: 0, revenue: 0, due: 0, paid: 0 },
  });
});

module.exports.searchPOSSales = module.exports.getAllPOSSales;

module.exports.getPOSSaleById = asyncHandler(async (req, res) => {
  const sale = await POSSale.findById(req.params.id).populate("createdBy", "name email").populate("cancelledBy", "name").lean();
  if (!sale) throw new AppError(404, "Sale not found");
  res.status(200).json({ success: true, sale: serialize.sale(sale, req.user.role) });
});

module.exports.getTodaySales = asyncHandler(async (req, res) => {
  const start = startOfDay();
  const [row] = await POSSale.aggregate(pipelines.periodTotals(start, addDays(start, 1)));
  const canSee = serialize.canSeeCost(req.user.role);
  res.json({
    success: true,
    orders: row?.orders || 0,
    totalSales: row?.revenue || 0,
    ...(canSee ? { totalProfit: row?.profit || 0 } : {}),
  });
});

module.exports.getRecentSales = asyncHandler(async (req, res) => {
  const sales = await POSSale.find().sort({ createdAt: -1 }).limit(10).lean();
  res.json({ success: true, sales: serialize.sales(sales, req.user.role) });
});

module.exports.cancelPOSSale = asyncHandler(async (req, res) => {
  const sale = await cancelSale({ id: req.params.id, reason: req.body.reason, user: req.user, ip: req.ip });
  res.json({ success: true, message: "Sale cancelled and stock restored.", sale: serialize.sale(sale, req.user.role) });
});
