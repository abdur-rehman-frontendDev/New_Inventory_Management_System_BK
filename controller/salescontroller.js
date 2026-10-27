// LEGACY single-product sales module. The POS (/api/posSales) is the live sales flow; these endpoints
// are kept (secured and fixed) so nothing that still calls them breaks.
const Sale = require("../models/Salesmodel");
const AppError = require("../helpers/AppError");
const asyncHandler = require("../helpers/asyncHandler");
const { contains } = require("../helpers/regex");
const { reserveStock, restoreStock } = require("../services/stockService");

const need = (p) => p && p.product && Number(p.quantity) > 0 && Number(p.price) >= 0;

module.exports.createSale = asyncHandler(async (req, res) => {
  const { customerName, products, paymentMethod, paymentStatus, status } = req.body;
  if (!customerName || !need(products) || !paymentMethod) throw new AppError(400, "All fields are required.");

  const line = { product: products.product, quantity: Number(products.quantity), name: "Product" };
  await reserveStock([line]);
  try {
    const sale = await Sale.create({
      customerName,
      products,
      totalAmount: Number(products.quantity) * Number(products.price),
      paymentMethod,
      paymentStatus,
      status,
    });
    res.status(201).json({ success: true, message: "Sale created successfully", sale });
  } catch (err) {
    await restoreStock([line]);
    throw err;
  }
});

module.exports.getAllSales = asyncHandler(async (req, res) => {
  const sales = await Sale.find().populate("products.product", "name sku").sort({ createdAt: -1 }).limit(500).lean();
  res.status(200).json({ success: true, sales });
});

module.exports.getSaleById = asyncHandler(async (req, res) => {
  const sale = await Sale.findById(req.params.saleId).populate("products.product");
  if (!sale) throw new AppError(404, "Sale not found");
  res.status(200).json({ success: true, sale });
});

module.exports.updateSale = asyncHandler(async (req, res) => {
  const data = req.body;
  if (!need(data.products)) throw new AppError(400, "Product, quantity, and price are required.");
  const sale = await Sale.findByIdAndUpdate(
    req.params.saleId,
    { ...data, totalAmount: Number(data.products.quantity) * Number(data.products.price) },
    { new: true, runValidators: true },
  );
  if (!sale) throw new AppError(404, "Sale not found.");
  res.status(200).json({ success: true, message: "Sale updated successfully", sale });
});

module.exports.SearchSales = asyncHandler(async (req, res) => {
  const q = (req.query.query || "").trim();
  const filter = q ? { $or: [{ customerName: contains(q) }, { paymentMethod: contains(q) }] } : {};
  const sales = await Sale.find(filter).populate("products.product", "name sku").limit(200).lean();
  res.status(200).json({ success: true, sales });
});
