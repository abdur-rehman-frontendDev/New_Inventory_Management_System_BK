// LEGACY: a second stock table that duplicated Product.quantity. Kept secured for compatibility;
// the single source of truth for stock is Product.quantity (changed through POS / stock movements).
const Inventory = require("../models/Inventorymodel");
const AppError = require("../helpers/AppError");
const asyncHandler = require("../helpers/asyncHandler");

module.exports.addOrUpdateInventory = asyncHandler(async (req, res) => {
  const { product, quantity } = req.body;
  if (!product || quantity === undefined || Number(quantity) < 0) throw new AppError(400, "Product and a valid quantity are required");
  let inventory = await Inventory.findOne({ product });
  if (inventory) {
    inventory.quantity = Number(quantity);
    inventory.lastUpdated = Date.now();
  } else {
    inventory = new Inventory({ product, quantity: Number(quantity) });
  }
  await inventory.save();
  res.status(200).json({ success: true, message: "Inventory updated successfully", inventory });
});

module.exports.getAllInventory = asyncHandler(async (req, res) => {
  const inventories = await Inventory.find().populate("product", "name sku").limit(1000).lean();
  res.status(200).json({ success: true, inventories });
});

module.exports.getInventoryByProduct = asyncHandler(async (req, res) => {
  const inventory = await Inventory.findOne({ product: req.params.productId }).populate("product", "name sku");
  if (!inventory) throw new AppError(404, "Inventory not found for this product");
  res.status(200).json({ success: true, inventory });
});

module.exports.deleteInventory = asyncHandler(async (req, res) => {
  const inventory = await Inventory.findOneAndDelete({ product: req.params.productId });
  if (!inventory) throw new AppError(404, "Inventory not found");
  res.status(200).json({ success: true, message: "Inventory deleted successfully" });
});
