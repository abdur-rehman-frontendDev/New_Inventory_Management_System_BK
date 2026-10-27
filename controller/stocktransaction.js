const StockTransaction = require("../models/StockTranscationmodel");
const Product = require("../models/Productmodel");
const asyncHandler = require("../helpers/asyncHandler");
const paginate = require("../helpers/pagination");
const { contains } = require("../helpers/regex");
const { applyMovement } = require("../services/stockService");
const logActivity = require("../libs/logger");

const POPULATE = [
  { path: "product", select: "name sku unit" },
  { path: "supplier", select: "name" },
  { path: "createdBy", select: "name" },
];

/** Records a movement AND updates the product's stock (before, it only wrote a log row). */
module.exports.createStockTransaction = asyncHandler(async (req, res) => {
  const { product, type, quantity, supplier, note } = req.body;

  const updated = await applyMovement({ product, type, quantity });

  let tx;
  try {
    tx = await StockTransaction.create({ product, type, quantity, supplier, note, balanceAfter: updated.quantity, createdBy: req.user._id });
  } catch (err) {
    // keep stock and history consistent
    await Product.updateOne({ _id: product }, { $inc: { quantity: type === "Stock-in" ? -quantity : quantity } });
    throw err;
  }

  await logActivity({
    action: type,
    description: `${type} of ${quantity} for "${updated.name}". New balance: ${updated.quantity}.`,
    entity: "stock",
    entityId: tx._id,
    userId: req.user._id,
    ipAddress: req.ip,
  });

  res.status(201).json({ success: true, message: "Stock transaction created successfully", transaction: tx, balance: updated.quantity });
});

module.exports.getAllStockTransactions = asyncHandler(async (req, res) => {
  const { page, limit, type, query } = req.query;
  const filter = {};
  if (["Stock-in", "Stock-out"].includes(type)) filter.type = type;
  if (query) {
    const ids = (await Product.find({ $or: [{ name: contains(query) }, { sku: contains(query) }] }).select("_id").limit(200).lean()).map((p) => p._id);
    filter.product = { $in: ids };
  }
  const result = await paginate({ model: StockTransaction, page, limit: limit || 15, query: filter, sort: { transactionDate: -1 }, populate: POPULATE });
  res.status(200).json({ success: true, transactions: result.data, pagination: result.pagination });
});

module.exports.searchStocks = module.exports.getAllStockTransactions;

module.exports.getStockTransactionsByProduct = asyncHandler(async (req, res) => {
  const transactions = await StockTransaction.find({ product: req.params.productId })
    .populate(POPULATE).sort({ transactionDate: -1 }).limit(200).lean();
  res.status(200).json({ success: true, transactions });
});

module.exports.getStockTransactionsBySupplier = asyncHandler(async (req, res) => {
  const transactions = await StockTransaction.find({ supplier: req.params.supplierId })
    .populate(POPULATE).sort({ transactionDate: -1 }).limit(200).lean();
  res.status(200).json({ success: true, transactions });
});
