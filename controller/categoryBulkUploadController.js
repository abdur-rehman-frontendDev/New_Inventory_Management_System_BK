const XLSX = require("xlsx");
const Category = require("../models/Categorymodel");
const AppError = require("../helpers/AppError");
const asyncHandler = require("../helpers/asyncHandler");
const logActivity = require("../libs/logger");

const norm = (v = "") => String(v ?? "").trim().replace(/\s+/g, " ").toLowerCase();

module.exports.template = asyncHandler(async (req, res) => {
  const ws = XLSX.utils.json_to_sheet([{ name: "Brakes", description: "Brake pads, discs and fluids" }], {
    header: ["name", "description"],
  });
  ws["!cols"] = [{ wch: 28 }, { wch: 48 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Categories");
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="categories-template.xlsx"');
  res.send(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
});

module.exports.UploadCategories = asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError(400, "Please upload an Excel or CSV file.");

  let rows;
  try {
    const wb = XLSX.read(req.file.buffer, { type: "buffer" });
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  } catch (e) {
    throw new AppError(400, "The file could not be read. Please upload a valid .xlsx, .xls or .csv file.");
  }
  if (!rows.length) throw new AppError(400, "The file is empty.");
  if (rows.length > 2000) throw new AppError(400, "Too many rows (max 2000 per upload).");

  const missing = ["name", "description"].filter((c) => !Object.keys(rows[0]).includes(c));
  if (missing.length) throw new AppError(400, `Required columns are missing: ${missing.join(", ")}`, missing);

  const existing = new Map((await Category.find({}, "_id name").lean()).map((c) => [norm(c.name), c]));
  const inserts = [];
  const updates = [];
  const skipped = [];
  const seen = new Set();

  rows.forEach((row, i) => {
    const name = String(row.name ?? "").trim();
    const description = String(row.description ?? "").trim();
    const key = norm(name);
    if (!name) return skipped.push({ row: i + 2, category: "", reason: "Category name missing" });
    if (seen.has(key)) return skipped.push({ row: i + 2, category: name, reason: "Duplicate category in file" });
    seen.add(key);
    const found = existing.get(key);
    if (found) updates.push({ updateOne: { filter: { _id: found._id }, update: { $set: { description } } } });
    else inserts.push({ name, description });
  });

  const inserted = inserts.length ? (await Category.insertMany(inserts, { ordered: false })).length : 0;
  const updated = updates.length ? (await Category.bulkWrite(updates)).matchedCount ?? updates.length : 0;

  await logActivity({
    action: "Bulk Upload Categories",
    description: `${inserted} added, ${updated} updated, ${skipped.length} skipped.`,
    entity: "category",
    userId: req.user._id,
    ipAddress: req.ip,
  });

  res.status(200).json({
    success: true,
    message: `Import finished: ${inserted} added, ${updated} updated, ${skipped.length} skipped.`,
    summary: { totalRows: rows.length, inserted, updated, skipped: skipped.length },
    skippedCategories: skipped,
  });
});
