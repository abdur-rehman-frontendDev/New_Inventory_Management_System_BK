const Product = require("../models/Productmodel");
const POSSale = require("../models/POSSaleModel");
const AppError = require("../helpers/AppError");
const generateInvoiceNumber = require("../libs/invoiceGenerator");
const logActivity = require("../libs/logger");
const { computeSaleTotals, round2 } = require("../helpers/money");
const { reserveStock, restoreStock } = require("./stockService");

/** Merge duplicate lines of the same product so stock checks are exact. */
const mergeLines = (items) => {
  const map = new Map();
  for (const { product, quantity } of items) {
    const key = String(product);
    map.set(key, (map.get(key) || 0) + Number(quantity));
  }
  return [...map.entries()].map(([product, quantity]) => ({ product, quantity: round2(quantity * 1000) / 1000 }));
};

/**
 * Create a POS invoice.
 *  1. Prices & costs come from the database (never from the client).
 *  2. Stock is reserved atomically (all-or-nothing).
 *  3. The invoice is stored; if that fails, stock is put back.
 */
const createSale = async ({ payload, user, ip }) => {
  const lines = mergeLines(payload.items);

  const products = await Product.find({ _id: { $in: lines.map((l) => l.product) } })
    .select("name sku barcode unit sellingPrice purchasePrice status")
    .lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));

  const items = lines.map((line) => {
    const p = byId.get(String(line.product));
    if (!p) throw new AppError(404, "One of the products no longer exists.");
    if (p.status !== "Active") throw new AppError(409, `${p.name} is inactive and cannot be sold.`);
    return {
      product: p._id,
      name: p.name,
      sku: p.sku || "",
      barcode: p.barcode || "",
      unit: p.unit || "Piece",
      quantity: line.quantity,
      purchasePrice: p.purchasePrice,
      unitPrice: p.sellingPrice,
      lineTotal: round2(p.sellingPrice * line.quantity),
    };
  });

  const totals = computeSaleTotals({
    items,
    discount: payload.discount,
    tax: payload.tax,
    paidAmount: payload.paidAmount,
  });

  await reserveStock(items);

  let sale;
  try {
    const invoiceNumber = await generateInvoiceNumber();
    sale = await POSSale.create({
      invoiceNumber,
      customerName: payload.customerName || "Walk-in Customer",
      customerPhone: payload.customerPhone || "",
      items,
      subtotal: totals.subtotal,
      discount: totals.discount,
      tax: totals.tax,
      grandTotal: totals.grandTotal,
      tenderedAmount: totals.tenderedAmount,
      paidAmount: totals.paidAmount,
      changeAmount: totals.changeAmount,
      dueAmount: totals.dueAmount,
      totalProfit: totals.totalProfit,
      paymentMethod: payload.paymentMethod,
      paymentStatus: totals.paymentStatus,
      status: "Completed",
      notes: payload.notes || "",
      createdBy: user._id,
      updatedBy: user._id,
    });
  } catch (err) {
    await restoreStock(items).catch((e) => console.error("Stock rollback failed:", e));
    throw err;
  }

  await logActivity({
    action: "POS Sale",
    description: `Invoice ${sale.invoiceNumber} created (Rs ${sale.grandTotal}).`,
    entity: "pos",
    entityId: sale._id,
    userId: user._id,
    ipAddress: ip,
  });

  return sale;
};

/**
 * Cancel an invoice and put its stock back. The status flip is an atomic "claim"
 * (`status: Completed` -> `Cancelled`) so a double click / two admins can't restore stock twice.
 */
const cancelSale = async ({ id, reason = "", user, ip }) => {
  const sale = await POSSale.findOneAndUpdate(
    { _id: id, status: "Completed" },
    {
      $set: {
        status: "Cancelled",
        paymentStatus: "Refunded",
        cancelledAt: new Date(),
        cancelledBy: user._id,
        cancelReason: reason,
        updatedBy: user._id,
      },
    },
    { new: true },
  );

  if (!sale) {
    const exists = await POSSale.exists({ _id: id });
    if (!exists) throw new AppError(404, "Sale not found.");
    throw new AppError(409, "This sale has already been cancelled.");
  }

  await restoreStock(sale.items);

  await logActivity({
    action: "Cancel POS Sale",
    description: `Invoice ${sale.invoiceNumber} cancelled${reason ? `: ${reason}` : ""}. Stock restored.`,
    entity: "pos",
    entityId: sale._id,
    userId: user._id,
    ipAddress: ip,
  });

  return sale;
};

module.exports = { createSale, cancelSale, mergeLines };
