const XLSX = require("xlsx");
const Product = require("../models/Productmodel");
const Category = require("../models/Categorymodel");
const AppError = require("../helpers/AppError");
const asyncHandler = require("../helpers/asyncHandler");
const { reserveCodes } = require("../libs/productCodeGenerator");
const columns = require("../helpers/excelColumns");
const logActivity = require("../libs/logger");

const norm = (v = "") =>
  String(v ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
const str = (v) => String(v ?? "").trim();
const isNonNegative = (v) =>
  v !== "" && v !== null && !Number.isNaN(Number(v)) && Number(v) >= 0;
const MAX_ROWS = 5000;
const REQUIRED = [
  "name",
  "Category",
  "purchasePrice",
  "sellingPrice",
  "quantity",
];

/** Downloadable template so users don't have to guess the column names. */
module.exports.template = asyncHandler(async (req, res) => {
  const example = {
    name: "Brake Pad Set (Front)",
    sku: "",
    barcode: "",
    Category: "Brakes",
    brand: "Toyota",
    unit: "Piece",
    purchasePrice: 3200,
    sellingPrice: 4200,
    quantity: 12,
    reorderLevel: 5,
    status: "Active",
    Description: "Fits Corolla 2014-2020",
  };
  const ws = XLSX.utils.json_to_sheet([example], { header: columns });
  ws["!cols"] = columns.map((c) => ({ wch: Math.max(c.length + 4, 14) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Products");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="products-template.xlsx"',
  );
  res.send(buffer);
});

module.exports.UploadProducts = asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError(400, "Please upload an Excel or CSV file.");

  let rows;
  try {
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
      defval: "",
    });
  } catch (e) {
    throw new AppError(
      400,
      "The file could not be read. Please upload a valid .xlsx, .xls or .csv file.",
    );
  }

  if (!rows.length) throw new AppError(400, "The file is empty.");
  if (rows.length > MAX_ROWS)
    throw new AppError(400, `Too many rows (max ${MAX_ROWS} per upload).`);

  const missingColumns = REQUIRED.filter(
    (c) => !Object.keys(rows[0]).includes(c),
  );
  if (missingColumns.length) {
    throw new AppError(
      400,
      `Required columns are missing: ${missingColumns.join(", ")}`,
      missingColumns,
    );
  }

  const categoryMap = new Map(
    (await Category.find({}, "_id name").lean()).map((c) => [norm(c.name), c]),
  );
  const productMap = new Map(
    (await Product.find({}, "_id name sku barcode").lean()).map((p) => [
      norm(p.name),
      p,
    ]),
  );

  const inserts = [];
  const updates = [];
  const skipped = [];
  const seen = new Set();

  for (const [index, row] of rows.entries()) {
    const rowNo = index + 2;
    const name = str(row.name);
    const key = norm(name);
    const skip = (reason) =>
      skipped.push({ row: rowNo, product: name, reason });

    if (!name) {
      skip("Product name is missing");
      continue;
    }
    if (
      ![row.purchasePrice, row.sellingPrice, row.quantity].every(isNonNegative)
    ) {
      skip("Purchase price, selling price and quantity must be numbers ≥ 0");
      continue;
    }
    if (seen.has(key)) {
      skip("Duplicate product in file");
      continue;
    }
    seen.add(key);

    const category = categoryMap.get(norm(row.Category));
    if (!category) {
      skip(`Category '${str(row.Category)}' not found`);
      continue;
    }

    const status = ["Active", "Inactive"].includes(str(row.status))
      ? str(row.status)
      : "Active";
    const fields = {
      Category: category._id,
      brand: str(row.brand),
      unit: str(row.unit) || "Piece",
      purchasePrice: Number(row.purchasePrice),
      sellingPrice: Number(row.sellingPrice),
      Price: Number(row.sellingPrice),
      quantity: Number(row.quantity),
      reorderLevel:
        isNonNegative(row.reorderLevel) && str(row.reorderLevel) !== ""
          ? Number(row.reorderLevel)
          : 5,
      status,
      Description: str(row.Description),
      updatedBy: req.user._id,
    };

    const existing = productMap.get(key);
    if (existing) {
      const set = { ...fields };
      if (str(row.sku)) set.sku = str(row.sku);
      if (str(row.barcode)) set.barcode = str(row.barcode);
      updates.push({
        updateOne: { filter: { _id: existing._id }, update: { $set: set } },
      });
    } else {
      inserts.push({
        name,
        sku: str(row.sku),
        barcode: str(row.barcode),
        ...fields,
        createdBy: req.user._id,
      });
    }
  }

  // Generate any missing SKU / barcode for ALL new rows with two atomic calls in total.
  const needSku = inserts.filter((r) => !r.sku).length;
  const needBar = inserts.filter((r) => !r.barcode).length;
  const codes = await reserveCodes(Math.max(needSku, needBar));
  let si = 0,
    bi = 0;
  inserts.forEach((r) => {
    if (!r.sku) r.sku = codes.skus[si++];
    if (!r.barcode) r.barcode = codes.barcodes[bi++];
  });

  let inserted = 0;
  let updated = 0;
  try {
    if (inserts.length)
      inserted = (await Product.insertMany(inserts, { ordered: false })).length;
    if (updates.length)
      updated =
        (await Product.bulkWrite(updates, { ordered: false })).matchedCount ??
        updates.length;
  } catch (err) {
    // Duplicate SKU/barcode etc. – report cleanly instead of a 500
    if (err.code === 11000 || err.writeErrors) {
      throw new AppError(
        409,
        "Some rows use a SKU or barcode that already belongs to another product. Fix the duplicates and try again.",
      );
    }
    throw err;
  }

  await logActivity({
    action: "Bulk Upload Products",
    description: `${inserted} product(s) added, ${updated} updated, ${skipped.length} skipped.`,
    entity: "product",
    userId: req.user._id,
    ipAddress: req.ip,
  });

  res.status(200).json({
    success: true,
    message: `Import finished: ${inserted} added, ${updated} updated, ${skipped.length} skipped.`,
    summary: {
      totalRows: rows.length,
      inserted,
      updated,
      skipped: skipped.length,
    },
    skippedProducts: skipped,
  });
});
