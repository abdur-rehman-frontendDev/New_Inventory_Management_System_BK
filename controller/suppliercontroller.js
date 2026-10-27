const Supplier = require("../models/Suppliermodel");
const AppError = require("../helpers/AppError");
const asyncHandler = require("../helpers/asyncHandler");
const { contains } = require("../helpers/regex");
const logActivity = require("../libs/logger");

const log = (req, action, description, supplier) =>
  logActivity({ action, description, entity: "supplier", entityId: supplier._id, userId: req.user._id, ipAddress: req.ip });

module.exports.createSupplier = asyncHandler(async (req, res) => {
  const supplier = await Supplier.create(req.body);
  await log(req, "Add Supplier", `Supplier "${supplier.name}" was added.`, supplier);
  res.status(201).json({ success: true, message: "Supplier created successfully", newSupplier: supplier });
});

module.exports.getAllSuppliers = asyncHandler(async (req, res) => {
  const filter = req.query.query ? { name: contains(req.query.query) } : {};
  const suppliers = await Supplier.find(filter).populate("productsSupplied", "name sku").sort({ name: 1 }).limit(500).lean();
  res.status(200).json(suppliers);
});

module.exports.getSupplierById = asyncHandler(async (req, res) => {
  const supplier = await Supplier.findById(req.params.supplierId).populate("productsSupplied", "name sku");
  if (!supplier) throw new AppError(404, "Supplier not found");
  res.status(200).json({ success: true, supplier });
});

module.exports.editSupplier = asyncHandler(async (req, res) => {
  const supplier = await Supplier.findById(req.params.supplierId);
  if (!supplier) throw new AppError(404, "Supplier not found");
  const { name, contactInfo, productsSupplied } = req.body;
  if (name) supplier.name = name;
  if (contactInfo) supplier.contactInfo = { ...supplier.contactInfo?.toObject?.(), ...contactInfo };
  if (productsSupplied) supplier.productsSupplied = productsSupplied;
  await supplier.save();
  await log(req, "Update Supplier", `Supplier "${supplier.name}" was updated.`, supplier);
  res.status(200).json({ message: "Supplier updated successfully", supplier });
});

module.exports.deleteSupplier = asyncHandler(async (req, res) => {
  const supplier = await Supplier.findByIdAndDelete(req.params.supplierId);
  if (!supplier) throw new AppError(404, "Supplier not found");
  await log(req, "Delete Supplier", `Supplier "${supplier.name}" was deleted.`, supplier);
  res.status(200).json({ success: true, message: "Supplier deleted successfully" });
});

module.exports.searchSupplier = asyncHandler(async (req, res) => {
  const q = (req.query.query || "").trim();
  if (!q) throw new AppError(400, "Query parameter is required");
  const suppliers = await Supplier.find({ name: contains(q) }).populate("productsSupplied", "name sku").limit(100).lean();
  res.json({ success: true, suppliers });
});
