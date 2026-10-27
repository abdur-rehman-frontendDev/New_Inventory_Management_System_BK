const Product = require("../models/Productmodel");
const Category = require("../models/Categorymodel");
const AppError = require("../helpers/AppError");
const asyncHandler = require("../helpers/asyncHandler");
const paginate = require("../helpers/pagination");
const { contains } = require("../helpers/regex");
const logActivity = require("../libs/logger");

/** Adds `productCount` to each category with ONE aggregation instead of one query per category. */
const withCounts = async (categories) => {
  if (!categories.length) return [];
  const counts = await Product.aggregate([
    { $match: { Category: { $in: categories.map((c) => c._id) } } },
    { $group: { _id: "$Category", count: { $sum: 1 } } },
  ]);
  const map = new Map(counts.map((c) => [String(c._id), c.count]));
  return categories.map((c) => ({ ...c, productCount: map.get(String(c._id)) || 0 }));
};

const list = asyncHandler(async (req, res) => {
  const { page, limit, query } = req.query;
  const filter = query ? { $or: [{ name: contains(query) }, { description: contains(query) }] } : {};
  const result = await paginate({ model: Category, page, limit, query: filter, sort: { name: 1 } });
  res.status(200).json({ categories: await withCounts(result.data), pagination: result.pagination });
});

module.exports.getCategory = list;
module.exports.Searchcategory = list;

/** Every category (for dropdowns). */
module.exports.getOptions = asyncHandler(async (req, res) => {
  const categories = await Category.find().select("name").sort({ name: 1 }).lean();
  res.json({ success: true, categories });
});

module.exports.createCategory = asyncHandler(async (req, res) => {
  const category = await Category.create(req.body);
  await logActivity({
    action: "Add Category",
    description: `Category "${category.name}" was added.`,
    entity: "category",
    entityId: category._id,
    userId: req.user._id,
    ipAddress: req.ip,
  });
  res.status(201).json(category);
});

module.exports.updateCategory = asyncHandler(async (req, res) => {
  // The old route had no :CategoryId param, so updating never worked. Now: PUT /updateCategory/:CategoryId
  const id = req.params.CategoryId;
  const data = req.body;
  if (!Object.keys(data).length) throw new AppError(400, "Nothing to update.");

  const category = await Category.findByIdAndUpdate(id, data, { new: true, runValidators: true });
  if (!category) throw new AppError(404, "Category not found.");

  await logActivity({
    action: "Update Category",
    description: `Category "${category.name}" was updated.`,
    entity: "category",
    entityId: category._id,
    userId: req.user._id,
    ipAddress: req.ip,
  });
  res.status(200).json({ message: "Category successfully updated", category });
});

module.exports.RemoveCategory = asyncHandler(async (req, res) => {
  const { CategoryId } = req.params;
  const inUse = await Product.countDocuments({ Category: CategoryId });
  if (inUse > 0) {
    throw new AppError(409, `This category still has ${inUse} product${inUse > 1 ? "s" : ""}. Move or delete them first.`);
  }
  const deleted = await Category.findByIdAndDelete(CategoryId);
  if (!deleted) throw new AppError(404, "Category is not found!");

  await logActivity({
    action: "Delete Category",
    description: `Category "${deleted.name}" was deleted.`,
    entity: "category",
    entityId: deleted._id,
    userId: req.user._id,
    ipAddress: req.ip,
  });
  res.status(200).json({ message: "Category deleted successfully" });
});
