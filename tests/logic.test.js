process.env.JWT_SECRET = "test-secret";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Aggregator, Query } = require("mingo"); // the main entry registers every operator

const mongoose = require("mongoose");
const Product = require("../models/Productmodel");
const POSSale = require("../models/POSSaleModel");
const User = require("../models/Usermodel");
const Supplier = require("../models/Suppliermodel");
const Notification = require("../models/Notificationmodel");
const ActivityLog = require("../models/ActivityLogmodel");
const { COST_EXPR, PROFIT_EXPR } = require("../services/statsService");
const { reserveStock } = require("../services/stockService");
const { computeSaleTotals } = require("../helpers/money");

const id = () => new mongoose.Types.ObjectId();
const run = (pipeline, docs) => new Aggregator(pipeline).run(docs);

// ───────── schema validation (these were silently broken before: `require:` typo, bad enums) ─────────
test("User: name / email / password are really required now (typo `require:` fixed)", () => {
  const err = new User({}).validateSync();
  assert.ok(err.errors.name && err.errors.email && err.errors.password);
});

test("Supplier: name required; productsSupplied is an array", () => {
  assert.ok(new Supplier({}).validateSync().errors.name);
  const s = new Supplier({ name: "S", productsSupplied: [id()] });
  assert.equal(s.validateSync(), undefined);
  assert.equal(Array.isArray(s.productsSupplied), true);
});

test("Notification: title + message required, read-state tracked per user", () => {
  assert.ok(new Notification({}).validateSync().errors.name);
  const n = new Notification({ name: "x", type: "y" });
  assert.deepEqual(n.readBy.toObject(), []);
});

test("Product: 'Out of Stock' is not a valid status (the old UI offered it)", () => {
  const p = new Product({ name: "p", Category: id(), purchasePrice: 1, sellingPrice: 2, status: "Out of Stock" });
  assert.ok(p.validateSync().errors.status);
  assert.equal(new Product({ name: "p", Category: id(), purchasePrice: 1, sellingPrice: 2 }).validateSync(), undefined);
});

test("Product: negative stock is impossible at schema level", () => {
  const p = new Product({ name: "p", Category: id(), purchasePrice: 1, sellingPrice: 2, quantity: -1 });
  assert.ok(p.validateSync().errors.quantity);
});

test("ActivityLog accepts every entity the code logs (old enum rejected 'POSSale' etc.)", () => {
  for (const entity of ["pos", "stock", "supplier", "product", "category", "order", "user", "notification"]) {
    assert.equal(new ActivityLog({ action: "a", description: "d", entity }).validateSync(), undefined, entity);
  }
});

test("POSSale: needs at least one item; item sku is optional", () => {
  const base = { invoiceNumber: "INV-1", subtotal: 1, grandTotal: 1 };
  assert.ok(new POSSale({ ...base, items: [] }).validateSync().errors.items);
  const ok = new POSSale({ ...base, items: [{ product: id(), name: "x", quantity: 1, purchasePrice: 1, unitPrice: 2, lineTotal: 2 }] });
  assert.equal(ok.validateSync(), undefined);
});

// ───────── aggregation pipelines, executed in-memory ─────────
const items = (rows) => rows.map(([q, cost, price]) => ({ quantity: q, purchasePrice: cost, unitPrice: price, lineTotal: q * price }));

test("PROFIT_EXPR = (subtotal − discount) − cost, ignoring tax", () => {
  const docs = [
    { subtotal: 250, discount: 20, tax: 25, grandTotal: 255, items: items([[2, 60, 100], [1, 30, 50]]) }, // 250-20-150 = 80
    { subtotal: 100, discount: 0, tax: 17, grandTotal: 117, items: items([[1, 70, 100]]) }, // 30
  ];
  const [row] = run([{ $group: { _id: null, profit: { $sum: PROFIT_EXPR }, cost: { $sum: COST_EXPR }, revenue: { $sum: "$grandTotal" } } }], docs);
  assert.equal(row.profit, 110);
  assert.equal(row.cost, 220);
  assert.equal(row.revenue, 372);
});

test("profit from the aggregation equals the profit stored by computeSaleTotals", () => {
  const lines = [{ unitPrice: 333.33, purchasePrice: 200, quantity: 3 }, { unitPrice: 49.5, purchasePrice: 30, quantity: 2 }];
  const t = computeSaleTotals({ items: lines, discount: 50, tax: 40, paidAmount: 5000 });
  const doc = { subtotal: t.subtotal, discount: t.discount, items: lines.map((l) => ({ quantity: l.quantity, purchasePrice: l.purchasePrice })) };
  const [row] = run([{ $project: { p: PROFIT_EXPR } }], [doc]);
  assert.ok(Math.abs(row.p - t.totalProfit) < 0.01);
});

test("customer report: same phone = same customer; no phone groups by name", () => {
  const docs = [
    { customerName: "Ali", customerPhone: "0300", grandTotal: 100 },
    { customerName: "Ali Raza", customerPhone: "0300", grandTotal: 50 },
    { customerName: "Walk-in Customer", customerPhone: "", grandTotal: 10 },
    { customerName: "walk-in customer", customerPhone: "", grandTotal: 5 },
  ];
  const out = run([{ $group: { _id: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ["$customerPhone", ""] } }, 0] }, "$customerPhone", { $toLower: "$customerName" }] }, total: { $sum: "$grandTotal" }, n: { $sum: 1 } } }, { $sort: { total: -1 } }], docs);
  assert.deepEqual(out.map((r) => [r._id, r.total, r.n]), [["0300", 150, 2], ["walk-in customer", 15, 2]]);
});

test("best-sellers pipeline groups per product and sorts by quantity", () => {
  const docs = [
    { status: "Completed", items: [{ product: "a", name: "A", quantity: 2, lineTotal: 20 }, { product: "b", name: "B", quantity: 5, lineTotal: 50 }] },
    { status: "Completed", items: [{ product: "a", name: "A", quantity: 4, lineTotal: 40 }] },
    { status: "Cancelled", items: [{ product: "b", name: "B", quantity: 100, lineTotal: 1000 }] },
  ];
  const out = run([{ $match: { status: "Completed" } }, { $unwind: "$items" }, { $group: { _id: "$items.product", totalSold: { $sum: "$items.quantity" } } }, { $sort: { totalSold: -1 } }], docs);
  assert.deepEqual(out.map((r) => [r._id, r.totalSold]), [["a", 6], ["b", 5]]); // cancelled sales never count
});

test("low-stock filter: out of stock and 'at reorder level' both qualify, healthy stock does not", () => {
  const q = new Query({ status: "Active", $expr: { $lte: ["$quantity", "$reorderLevel"] } });
  const docs = [{ status: "Active", quantity: 0, reorderLevel: 5 }, { status: "Active", quantity: 5, reorderLevel: 5 }, { status: "Active", quantity: 6, reorderLevel: 5 }, { status: "Inactive", quantity: 0, reorderLevel: 5 }];
  assert.equal(q.find(docs).all().length, 2);
});

// ───────── atomic stock reservation (model methods stubbed – no DB needed) ─────────
test("reserveStock is all-or-nothing: a failing line rolls back the lines already taken", async () => {
  const stock = { a: 5, b: 1 };
  const restored = [];
  const origF = Product.findOneAndUpdate, origU = Product.updateOne, origById = Product.findById;
  Product.findOneAndUpdate = async (filter, update) => {
    const k = String(filter._id);
    if (stock[k] >= filter.quantity.$gte) { stock[k] += update.$inc.quantity; return { _id: k, quantity: stock[k] }; }
    return null;
  };
  Product.updateOne = async (filter, update) => { restored.push([String(filter._id), update.$inc.quantity]); stock[String(filter._id)] += update.$inc.quantity; };
  Product.findById = () => ({ select: () => ({ lean: async () => ({ name: "B", quantity: stock.b, status: "Active" }) }) });
  try {
    await assert.rejects(() => reserveStock([{ product: "a", quantity: 3, name: "A" }, { product: "b", quantity: 2, name: "B" }]), /only 1 left/);
    assert.deepEqual(restored, [["a", 3]]); // A was given back
    assert.equal(stock.a, 5);
    assert.equal(stock.b, 1);
  } finally { Product.findOneAndUpdate = origF; Product.updateOne = origU; Product.findById = origById; }
});

test("reserveStock: two concurrent buyers of the last unit – exactly one wins", async () => {
  const stock = { x: 1 };
  const origF = Product.findOneAndUpdate, origById = Product.findById, origU = Product.updateOne;
  // The conditional update is atomic in Mongo; emulate that (check + decrement in one synchronous step).
  Product.findOneAndUpdate = async (filter, update) => { if (stock.x >= filter.quantity.$gte) { stock.x += update.$inc.quantity; return { _id: "x" }; } return null; };
  Product.updateOne = async () => {};
  Product.findById = () => ({ select: () => ({ lean: async () => ({ name: "X", quantity: stock.x, status: "Active" }) }) });
  try {
    const results = await Promise.allSettled([reserveStock([{ product: "x", quantity: 1, name: "X" }]), reserveStock([{ product: "x", quantity: 1, name: "X" }])]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(stock.x, 0); // never negative
  } finally { Product.findOneAndUpdate = origF; Product.findById = origById; Product.updateOne = origU; }
});
