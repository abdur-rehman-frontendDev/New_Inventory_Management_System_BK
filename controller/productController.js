const Product = require("../models/Productmodel");
const Category = require("../models/Categorymodel");
const AppError = require("../helpers/AppError");
const asyncHandler = require("../helpers/asyncHandler");
const paginate = require("../helpers/pagination");
const { contains } = require("../helpers/regex");
const serialize = require("../helpers/serializers");
const { generateSKU, generateBarcode } = require("../libs/productCodeGenerator");
const logActivity = require("../libs/logger");

const SORTS = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  name: { name: 1 },
  "stock-asc": { quantity: 1 },
  "stock-desc": { quantity: -1 },
  "price-asc": { sellingPrice: 1 },
  "price-desc": { sellingPrice: -1 },
};

/** Builds the Mongo filter for the product list from ?query=&status=&stock=&category= */
const buildFilter = async ({ query, status, stock, category }) => {
  const filter = {};
  if (status) filter.status = status;
  if (category) filter.Category = category;
  if (stock === "out") filter.quantity = { $lte: 0 };
  if (stock === "low") filter.$expr = { $and: [{ $gt: ["$quantity", 0] }, { $lte: ["$quantity", "$reorderLevel"] }] };
  if (stock === "in") filter.$expr = { $gt: ["$quantity", "$reorderLevel"] };

  if (query) {
    const matchingCategories = await Category.find({ name: contains(query) }).select("_id").lean();
    filter.$or = [
      { name: contains(query) },
      { sku: contains(query) },
      { barcode: contains(query) },
      { brand: contains(query) },
      { Description: contains(query) },
      { Category: { $in: matchingCategories.map((c) => c._id) } },
    ];
  }
  return filter;
};

const list = asyncHandler(async (req, res) => {
  const { page, limit, sort, ...rest } = req.query;
  const result = await paginate({
    model: Product,
    page,
    limit,
    query: await buildFilter(rest),
    sort: SORTS[sort] || SORTS.newest,
    populate: "Category",
  });

  res.status(200).json({
    Products: serialize.products(result.data, req.user.role),
    pagination: result.pagination,
  });
});

module.exports.getProduct = list;
module.exports.SearchProduct = list;

module.exports.Addproduct = asyncHandler(async (req, res) => {
  const data = { ...req.body };

  if (!(await Category.exists({ _id: data.Category }))) throw new AppError(400, "Selected category does not exist.");

  data.sku = data.sku || (await generateSKU());
  data.barcode = data.barcode || (await generateBarcode());

  const product = await Product.create({
    ...data,
    Price: data.sellingPrice,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  await logActivity({
    action: "Add Product",
    description: `Product "${product.name}" was added (qty ${product.quantity}).`,
    entity: "product",
    entityId: product._id,
    userId: req.user._id,
    ipAddress: req.ip,
  });

  res.status(201).json({ message: "Product created successfully", product });
});

module.exports.EditProduct = asyncHandler(async (req, res) => {
  const productId = req.params.productId || req.body.productId;
  const existing = await Product.findById(productId);
  if (!existing) throw new AppError(404, "Product not found.");

  const updates = { ...req.body }; // already whitelisted + validated by zod
  if (Object.keys(updates).length === 0) throw new AppError(400, "No valid fields to update.");

  if (updates.Category && !(await Category.exists({ _id: updates.Category }))) {
    throw new AppError(400, "Selected category does not exist.");
  }
  // Empty SKU/barcode would collide on the unique index – keep the current value instead.
  if (updates.sku === "") delete updates.sku;
  if (updates.barcode === "") delete updates.barcode;

  const before = existing.quantity;
  existing.set({ ...updates, updatedBy: req.user._id });
  await existing.save(); // runs validators + keeps legacy `Price` in sync

  const qtyNote = updates.quantity !== undefined && updates.quantity !== before ? ` Stock ${before} → ${existing.quantity}.` : "";
  await logActivity({
    action: "Update Product",
    description: `Product "${existing.name}" was updated.${qtyNote}`,
    entity: "product",
    entityId: existing._id,
    userId: req.user._id,
    ipAddress: req.ip,
  });

  res.status(200).json(existing);
});

module.exports.RemoveProduct = asyncHandler(async (req, res) => {
  const deleted = await Product.findByIdAndDelete(req.params.productId);
  if (!deleted) throw new AppError(404, "Product not found!");

  await logActivity({
    action: "Delete Product",
    description: `Product "${deleted.name}" was deleted.`,
    entity: "product",
    entityId: deleted._id,
    userId: req.user._id,
    ipAddress: req.ip,
  });
  res.status(200).json({ message: "Product deleted successfully" });
});

/** Lightweight list for dropdowns (stock movement, supplier, order forms). */
module.exports.getOptions = asyncHandler(async (req, res) => {
  const products = await Product.find({ status: "Active" })
    .select("name sku barcode quantity unit sellingPrice")
    .sort({ name: 1 })
    .limit(2000)
    .lean();
  res.json({ success: true, products });
});

/** Exact barcode / SKU lookup for the POS scanner. */
module.exports.lookup = asyncHandler(async (req, res) => {
  const code = String(req.params.code || "").trim();
  const product = await Product.findOne({ $or: [{ barcode: code }, { sku: code }], status: "Active" })
    .populate("Category", "name")
    .lean();
  if (!product) throw new AppError(404, "No product matches this code.");
  res.json({ success: true, product: serialize.product(product, req.user.role) });
});

module.exports.getTopProductsByQuantity = asyncHandler(async (req, res) => {
  const topProducts = await Product.find({}).sort({ quantity: -1 }).limit(10).lean();
  res.status(200).json({ success: true, topProducts: serialize.products(topProducts, req.user.role) });
});
