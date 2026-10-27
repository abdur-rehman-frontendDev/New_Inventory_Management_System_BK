/**
 * End-to-end API flow against a REAL MongoDB-compatible server.
 *   TEST_MONGODB_URL=mongodb://127.0.0.1:27018 npm run test:integration
 * (a throw-away database is created and dropped automatically)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const XLSX = require("xlsx");
const { Aggregator, Query } = require("mingo");

const base = process.env.TEST_MONGODB_URL;
if (!base) { console.log("TEST_MONGODB_URL not set – skipping integration tests"); process.exit(0); }
const dbName = `inv_it_${Date.now()}`;
process.env.MONGODB_URL = `${base.replace(/\/$/, "")}/${dbName}`;
process.env.JWT_SECRET = "integration-secret";
process.env.ALLOW_PUBLIC_SIGNUP = "false";
process.env.APP_TIMEZONE = "Asia/Karachi";

const mongoose = require("mongoose");
const app = require("../../api/index");

let server, url;
const S = {}; // shared state across the ordered flow

const api = async (method, path, { token, body, form, headers } = {}) => {
  const h = { ...(headers || {}) };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { h["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(url + path, { method, headers: h, body: payload });
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer());
  if (res.status >= 500) console.log(`  [500] ${method} ${path} → ${JSON.stringify(data).slice(0, 220)}`);
  return { status: res.status, data, headers: res.headers };
};

/**
 * Real MongoDB guarantees that a single-document findOneAndUpdate with a filter is atomic. Some stand-in engines
 * (FerretDB/SQLite) do not, so we probe first and run the *concurrent* assertions only when the engine honours it.
 * The sequential versions of the same checks always run.
 */
let ATOMIC = false;
const probeAtomic = async () => {
  const col = mongoose.connection.db.collection("atomic_probe");
  for (let round = 0; round < 8; round++) {
    const { insertedId } = await col.insertOne({ s: "open" });
    const res = await Promise.all(Array.from({ length: 6 }, () => col.findOneAndUpdate({ _id: insertedId, s: "open" }, { $set: { s: "taken" } })));
    if (res.filter(Boolean).length !== 1) return false;
  }
  return true;
};


const { installShim, engineNeedsShim } = require("../helpers/engineShim");

test.before(async () => {
  await mongoose.connect(process.env.MONGODB_URL);
  if (await engineNeedsShim()) { installShim(); console.log("\n[engine] limited aggregation support → running aggregate()/$expr through the in-memory engine over real stored documents"); }
  ATOMIC = await probeAtomic();
  console.log(`\n[engine] atomic findOneAndUpdate: ${ATOMIC ? "yes – concurrency tests ENABLED" : "NO – concurrency tests run sequentially (will run fully on real MongoDB)"}`);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  url = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  try { await mongoose.connection.dropDatabase(); } catch {}
  await mongoose.disconnect();
  server.close();
});

/**
 * The throw-away database used here (FerretDB) implements only part of MongoDB's query language.
 * When it answers "not implemented yet" that is a limitation of the TEST ENGINE, not an app bug; we report it
 * loudly and cover the same expressions with the in-memory engine in tests/logic.test.js instead.
 */
const LIMITS = [];
const limited = (r, label) => {
  if (r.status === 500 && /not implemented yet/i.test(JSON.stringify(r.data))) { LIMITS.push(`${label}: ${String(r.data.message).slice(0, 90)}`); return true; }
  return false;
};
test.after(() => { if (LIMITS.length) console.log("\n[test-engine limits – not app failures]\n  " + LIMITS.join("\n  ")); });

const login = async (email, password) => (await api("POST", "/api/auth/login", { body: { email, password } }));

// ───────────────────────── auth & users ─────────────────────────
test("01 bootstrap: sign-up is open only for the very first account, which becomes ADMIN", async () => {
  let r = await api("GET", "/api/auth/signup-status");
  assert.deepEqual([r.data.open, r.data.bootstrap], [true, true]);
  r = await api("POST", "/api/auth/signup", { body: { name: "Ada Admin", email: "ADA@shop.pk", password: "Passw0rdAda", role: "staff" } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.savedUser.role, "admin"); // first user = admin, client role ignored
  assert.equal(r.data.savedUser.email, "ada@shop.pk");
  S.admin = r.data.savedUser.token;
  S.adminId = r.data.savedUser.id;
});

test("02 after the first account, public sign-up is closed (and cannot self-assign admin)", async () => {
  let r = await api("GET", "/api/auth/signup-status");
  assert.equal(r.data.open, false);
  r = await api("POST", "/api/auth/signup", { body: { name: "Eve", email: "eve@x.com", password: "Passw0rd1", role: "admin" } });
  assert.equal(r.status, 403);
});

test("03 login: wrong password / unknown email give the SAME message; right password works; /me works", async () => {
  const a = await login("ada@shop.pk", "wrong-password1");
  const b = await login("nobody@shop.pk", "wrong-password1");
  assert.equal(a.status, 401); assert.equal(b.status, 401);
  assert.equal(a.data.message, b.data.message);
  const ok = await login("ada@shop.pk", "Passw0rdAda");
  assert.equal(ok.status, 200);
  assert.ok(ok.headers.get("set-cookie")?.includes("HttpOnly"));
  const me = await api("GET", "/api/auth/me", { token: ok.data.user.token });
  assert.equal(me.data.user.role, "admin");
  assert.equal(me.data.user.password, undefined);
});

test("04 admin creates a manager and a staff user; they can log in", async () => {
  let r = await api("POST", "/api/auth/users", { token: S.admin, body: { name: "Mo Manager", email: "mo@shop.pk", password: "Passw0rdMo", role: "manager" } });
  assert.equal(r.status, 201, JSON.stringify(r.data)); S.managerId = r.data.user.id;
  r = await api("POST", "/api/auth/users", { token: S.admin, body: { name: "Sam Staff", email: "sam@shop.pk", password: "Passw0rdSam", role: "staff" } });
  assert.equal(r.status, 201); S.staffId = r.data.user.id;
  S.manager = (await login("mo@shop.pk", "Passw0rdMo")).data.user.token;
  S.staff = (await login("sam@shop.pk", "Passw0rdSam")).data.user.token;
  assert.ok(S.manager && S.staff);
  const dup = await api("POST", "/api/auth/users", { token: S.admin, body: { name: "Dup", email: "mo@shop.pk", password: "Passw0rd99", role: "staff" } });
  assert.equal(dup.status, 409);
});

test("05 role enforcement: staff cannot manage users/products/reports; manager cannot manage users", async () => {
  assert.equal((await api("GET", "/api/auth/users", { token: S.staff })).status, 403);
  assert.equal((await api("GET", "/api/reports/summary", { token: S.staff })).status, 403);
  assert.equal((await api("POST", "/api/category/createcategory", { token: S.staff, body: { name: "X" } })).status, 403);
  assert.equal((await api("POST", "/api/auth/users", { token: S.manager, body: { name: "N", email: "n@x.com", password: "Passw0rd1", role: "staff" } })).status, 403);
  assert.equal((await api("DELETE", `/api/auth/removeuser/${S.staffId}`, { token: S.manager })).status, 403);
  assert.equal((await api("GET", "/api/auth/users", { token: S.manager })).status, 200);
});

// ───────────────────────── catalogue ─────────────────────────
test("06 categories: create, duplicate rejected, update works (route had no id before), list has productCount", async () => {
  let r = await api("POST", "/api/category/createcategory", { token: S.manager, body: { name: "Brakes", description: "Pads" } });
  assert.equal(r.status, 201, JSON.stringify(r.data)); S.catBrakes = r.data._id;
  r = await api("POST", "/api/category/createcategory", { token: S.manager, body: { name: "Filters" } });
  S.catFilters = r.data._id;
  assert.equal((await api("POST", "/api/category/createcategory", { token: S.manager, body: { name: "Brakes" } })).status, 409);
  r = await api("PUT", `/api/category/updateCategory/${S.catBrakes}`, { token: S.manager, body: { description: "Pads & discs" } });
  assert.equal(r.status, 200); assert.equal(r.data.category.description, "Pads & discs");
  r = await api("GET", "/api/category/getcategory", { token: S.staff });
  assert.equal(r.status, 200); assert.equal(r.data.categories.length, 2);
  assert.equal(r.data.categories[0].productCount, 0);
});

const mkProduct = (over = {}) => ({ name: "Brake Pad Set", Category: S.catBrakes, purchasePrice: 800, sellingPrice: 1000, quantity: 10, reorderLevel: 3, unit: "Piece", ...over });

test("07 products: create (SKU/barcode auto), validation, whitelisted edit, no mass assignment", async () => {
  let r = await api("POST", "/api/product/addproduct", { token: S.manager, body: mkProduct() });
  assert.equal(r.status, 201, JSON.stringify(r.data)); S.p1 = r.data.product;
  assert.match(r.data.product.sku, /^SKU\d{6}$/); assert.ok(r.data.product.barcode);
  r = await api("POST", "/api/product/addproduct", { token: S.manager, body: mkProduct({ name: "Oil Filter", Category: S.catFilters, purchasePrice: 300, sellingPrice: 500, quantity: 2, reorderLevel: 5 }) });
  S.p2 = r.data.product;
  r = await api("POST", "/api/product/addproduct", { token: S.manager, body: mkProduct({ name: "Coolant", Category: S.catFilters, quantity: 0 }) });
  S.p3 = r.data.product;
  assert.equal((await api("POST", "/api/product/addproduct", { token: S.manager, body: mkProduct({ name: "Bad", sellingPrice: -5 }) })).status, 400);
  assert.equal((await api("POST", "/api/product/addproduct", { token: S.manager, body: mkProduct({ name: "Bad", status: "Out of Stock" }) })).status, 400);
  assert.equal((await api("POST", "/api/product/addproduct", { token: S.manager, body: mkProduct({ Category: "507f1f77bcf86cd799439011" }) })).status, 400);
  // mass assignment: createdBy / _id are dropped, real fields change
  r = await api("PUT", `/api/product/editproduct/${S.p1._id}`, { token: S.manager, body: { sellingPrice: 1100, createdBy: "507f1f77bcf86cd799439011", _id: "x" } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.sellingPrice, 1100); assert.equal(r.data.Price, 1100); assert.notEqual(String(r.data.createdBy), "507f1f77bcf86cd799439011");
  // legacy request shape still accepted
  r = await api("PUT", `/api/product/editproduct/${S.p1._id}`, { token: S.manager, body: { productId: S.p1._id, updatedData: { sellingPrice: 1000 } } });
  assert.equal(r.data.sellingPrice, 1000);
});

test("08 product list: search (regex-safe), stock filters, sorting, pagination, staff don't see cost", async () => {
  let r = await api("GET", "/api/product/getproduct?stock=low", { token: S.manager });
  assert.deepEqual(r.data.Products.map((p) => p.name), ["Oil Filter"]);
  r = await api("GET", "/api/product/getproduct?stock=out", { token: S.manager });
  assert.deepEqual(r.data.Products.map((p) => p.name), ["Coolant"]);
  r = await api("GET", "/api/product/getproduct?stock=in", { token: S.manager });
  assert.deepEqual(r.data.Products.map((p) => p.name), ["Brake Pad Set"]);
  r = await api("GET", "/api/product/getproduct?query=brak", { token: S.manager });
  assert.equal(r.data.Products.length, 1);
  r = await api("GET", "/api/product/getproduct?query=Brakes", { token: S.manager }); // matches by category name
  assert.equal(r.data.Products.length, 1);
  r = await api("GET", "/api/product/getproduct?query=" + encodeURIComponent("(a+)+$"), { token: S.manager }); // ReDoS-style input is inert
  assert.equal(r.status, 200); assert.equal(r.data.Products.length, 0);
  r = await api("GET", "/api/product/getproduct?sort=name&limit=2&page=2", { token: S.manager });
  assert.equal(r.data.Products.length, 1); assert.equal(r.data.pagination.totalRecords, 3);
  r = await api("GET", "/api/product/getproduct?limit=100000", { token: S.manager });
  assert.equal(r.data.pagination.perPage, 100);
  r = await api("GET", "/api/product/getproduct", { token: S.staff });
  assert.equal(r.data.Products[0].purchasePrice, undefined);
  r = await api("GET", "/api/product/getproduct?category=" + S.catFilters, { token: S.manager });
  assert.equal(r.data.Products.length, 2);
  r = await api("GET", "/api/product/getproduct?status=&stock=", { token: S.manager }); // empty params tolerated
  assert.equal(r.status, 200);
});

test("09 barcode / SKU lookup and options endpoint", async () => {
  let r = await api("GET", `/api/product/lookup/${S.p1.barcode}`, { token: S.staff });
  assert.equal(r.status, 200); assert.equal(r.data.product.name, "Brake Pad Set");
  r = await api("GET", `/api/product/lookup/${S.p1.sku}`, { token: S.staff });
  assert.equal(r.status, 200);
  assert.equal((await api("GET", "/api/product/lookup/NOPE", { token: S.staff })).status, 404);
  r = await api("GET", "/api/product/options", { token: S.staff });
  assert.equal(r.data.products.length, 3);
});

test("10 category with products cannot be deleted; empty one can", async () => {
  const r = await api("DELETE", `/api/category/removecategory/${S.catBrakes}`, { token: S.manager });
  assert.equal(r.status, 409);
  const c = await api("POST", "/api/category/createcategory", { token: S.manager, body: { name: "Temp" } });
  assert.equal((await api("DELETE", `/api/category/removecategory/${c.data._id}`, { token: S.manager })).status, 200);
});

// ───────────────────────── suppliers & stock ─────────────────────────
test("11 suppliers: CRUD with product list; /searchSupplier is no longer shadowed by /:supplierId", async () => {
  let r = await api("POST", "/api/supplier/createsupplier", { token: S.manager, body: { name: "Toyota Parts", contactInfo: { phone: "0300", email: "t@x.com" }, productsSupplied: S.p1._id } });
  assert.equal(r.status, 201, JSON.stringify(r.data)); S.sup = r.data.newSupplier._id;
  r = await api("GET", "/api/supplier/searchSupplier?query=toy", { token: S.manager });
  assert.equal(r.status, 200); assert.equal(r.data.suppliers.length, 1);
  r = await api("GET", "/api/supplier/getallsupplier", { token: S.manager });
  assert.equal(r.data[0].productsSupplied[0].name, "Brake Pad Set");
  r = await api("PUT", `/api/supplier/updatesupplier/${S.sup}`, { token: S.manager, body: { name: "Toyota Genuine", productsSupplied: [S.p1._id, S.p2._id] } });
  assert.equal(r.status, 200); assert.equal(r.data.supplier.productsSupplied.length, 2);
  assert.equal((await api("GET", "/api/supplier/getallsupplier", { token: S.staff })).status, 403);
});

test("12 stock movements change stock, store balance, reject over-removal", async () => {
  let r = await api("POST", "/api/stocktransaction/createStockTransaction", { token: S.manager, body: { product: S.p3._id, type: "Stock-in", quantity: 20, supplier: S.sup, note: "Invoice 1" } });
  assert.equal(r.status, 201, JSON.stringify(r.data)); assert.equal(r.data.balance, 20);
  r = await api("POST", "/api/stocktransaction/createStockTransaction", { token: S.manager, body: { product: S.p3._id, type: "Stock-out", quantity: 5 } });
  assert.equal(r.data.balance, 15);
  r = await api("POST", "/api/stocktransaction/createStockTransaction", { token: S.manager, body: { product: S.p3._id, type: "Stock-out", quantity: 999 } });
  assert.equal(r.status, 409);
  r = await api("GET", "/api/product/getproduct?query=Coolant", { token: S.manager });
  assert.equal(r.data.Products[0].quantity, 15); // stock really changed
  r = await api("GET", "/api/stocktransaction/getallStockTransaction?type=Stock-in&query=cool", { token: S.manager });
  assert.equal(r.data.transactions.length, 1);
  assert.equal(r.data.transactions[0].product.name, "Coolant");
  assert.equal(r.data.transactions[0].supplier.name, "Toyota Genuine");
  assert.equal(r.data.transactions[0].balanceAfter, 20);
});

// ───────────────────────── POS ─────────────────────────
const qtyOf = async (id) => (await api("GET", "/api/product/getproduct?limit=100", { token: S.manager })).data.Products.find((p) => p._id === id).quantity;

test("13 POS sale: server computes totals; stock decremented; forged fields ignored", async () => {
  const r = await api("POST", "/api/posSales/create", { token: S.staff, body: {
    customerName: "Ali Raza", customerPhone: "0321-1234567", paymentMethod: "JazzCash", discount: 100, tax: 50, paidAmount: 3000,
    paymentStatus: "Pending", dueAmount: -999, totalProfit: 999999,
    items: [{ product: S.p1._id, quantity: 2 }, { product: S.p2._id, quantity: 1 }, { product: S.p1._id, quantity: 1 }],
  } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const s = r.data.sale; S.sale1 = s;
  assert.match(s.invoiceNumber, /^INV-\d{6}$/);
  assert.equal(s.items.length, 2); // duplicate lines merged
  assert.equal(s.items.find((i) => i.name === "Brake Pad Set").quantity, 3);
  assert.equal(s.subtotal, 3500); assert.equal(s.grandTotal, 3450); // 3500 - 100 + 50
  assert.equal(s.paymentStatus, "Partial"); assert.equal(s.dueAmount, 450); // 3000 paid of 3450
  assert.equal(s.paidAmount, 3000); assert.equal(s.changeAmount, 0);
  assert.equal(s.totalProfit, undefined); // staff do not see profit
  assert.equal(await qtyOf(S.p1._id), 7); assert.equal(await qtyOf(S.p2._id), 1);
});

test("14 POS rejects bad input and never changes stock when it fails", async () => {
  const before = [await qtyOf(S.p1._id), await qtyOf(S.p2._id)];
  const bad = async (body) => (await api("POST", "/api/posSales/create", { token: S.staff, body })).status;
  assert.equal(await bad({ items: [{ product: S.p1._id, quantity: -5 }] }), 400);   // negative qty must not add stock
  assert.equal(await bad({ items: [{ product: S.p1._id, quantity: 0 }] }), 400);
  assert.equal(await bad({ items: [] }), 400);
  assert.equal(await bad({ items: [{ product: S.p1._id, quantity: 1 }], discount: 999999 }), 400);
  assert.equal(await bad({ items: [{ product: S.p1._id, quantity: 1 }], paidAmount: -1 }), 400);
  assert.equal(await bad({ items: [{ product: "507f1f77bcf86cd799439011", quantity: 1 }] }), 404);
  // second line is out of stock → the first line must be rolled back
  const r = await api("POST", "/api/posSales/create", { token: S.staff, body: { items: [{ product: S.p1._id, quantity: 1 }, { product: S.p2._id, quantity: 5 }] } });
  assert.equal(r.status, 409); assert.match(r.data.message, /only 1 left/i);
  assert.deepEqual([await qtyOf(S.p1._id), await qtyOf(S.p2._id)], before);
});

test("15 inactive products cannot be sold", async () => {
  await api("PUT", `/api/product/editproduct/${S.p3._id}`, { token: S.manager, body: { status: "Inactive" } });
  const r = await api("POST", "/api/posSales/create", { token: S.staff, body: { items: [{ product: S.p3._id, quantity: 1 }] } });
  assert.equal(r.status, 409); assert.match(r.data.message, /inactive/i);
  await api("PUT", `/api/product/editproduct/${S.p3._id}`, { token: S.manager, body: { status: "Active" } });
});

test("16 selling the last unit twice: the second sale is refused and stock never goes negative", async () => {
  const mk = () => api("POST", "/api/posSales/create", { token: S.staff, body: { items: [{ product: S.p2._id, quantity: 1 }], paidAmount: 500 } });
  const first = await mk();
  assert.equal(first.status, 201);
  const second = await mk();
  assert.equal(second.status, 409);
  assert.equal(await qtyOf(S.p2._id), 0);
});

test("16b (needs atomic engine) five simultaneous buyers of the last unit: exactly one wins", { skip: false }, async (t) => {
  if (!ATOMIC) return t.skip("engine is not atomic");
  await api("POST", "/api/stocktransaction/createStockTransaction", { token: S.manager, body: { product: S.p2._id, type: "Stock-in", quantity: 1 } });
  const mk = () => api("POST", "/api/posSales/create", { token: S.staff, body: { items: [{ product: S.p2._id, quantity: 1 }], paidAmount: 500 } });
  const results = await Promise.all([mk(), mk(), mk(), mk(), mk()]);
  assert.equal(results.filter((r) => r.status === 201).length, 1, results.map((r) => r.status).join());
  assert.equal(await qtyOf(S.p2._id), 0);
});

test("17 credit sale, overpayment (change), and invoice numbers are unique & sequential", async () => {
  let r = await api("POST", "/api/posSales/create", { token: S.manager, body: { customerName: "Hamza Autos", paidAmount: 0, items: [{ product: S.p1._id, quantity: 1 }] } });
  assert.equal(r.data.sale.paymentStatus, "Pending"); assert.equal(r.data.sale.dueAmount, 1000);
  assert.equal(r.data.sale.totalProfit, 200); // manager sees profit: 1000 - 800
  S.creditSale = r.data.sale;
  r = await api("POST", "/api/posSales/create", { token: S.manager, body: { paidAmount: 2000, items: [{ product: S.p1._id, quantity: 1 }] } });
  assert.equal(r.data.sale.paymentStatus, "Paid"); assert.equal(r.data.sale.changeAmount, 1000);
  assert.equal(r.data.sale.paidAmount, 1000); assert.equal(r.data.sale.tenderedAmount, 2000);
  assert.equal(r.data.sale.customerName, "Walk-in Customer");
  const all = (await api("GET", "/api/posSales/all?limit=100", { token: S.manager })).data.sales.map((x) => x.invoiceNumber);
  assert.equal(new Set(all).size, all.length);
  assert.ok(all.includes("INV-000001") && all.includes("INV-000002"));
});

test("18 invoice list: search, filters, stats, pagination; detail; staff cost hidden", async () => {
  let r = await api("GET", "/api/posSales/all?query=ali", { token: S.staff });
  assert.equal(r.data.sales.length, 1); assert.equal(r.data.sales[0].customerName, "Ali Raza");
  r = await api("GET", "/api/posSales/all?paymentStatus=Pending", { token: S.staff });
  assert.equal(r.data.sales.length, 1);
  r = await api("GET", "/api/posSales/all?period=today", { token: S.manager });
  assert.equal(r.data.pagination.totalRecords, r.data.sales.length);
  assert.equal(r.data.stats.invoices, 4); // (revenue/due are verified by the pipeline test below – the test engine mis-sums multiple $sum)
  r = await api("GET", "/api/posSales/all?limit=2&page=2", { token: S.manager });
  assert.equal(r.data.pagination.currentPage, 2);
  r = await api("GET", `/api/posSales/${S.sale1._id}`, { token: S.staff });
  assert.equal(r.status, 200); assert.equal(r.data.sale.createdBy.name, "Sam Staff"); assert.equal(r.data.sale.items[0].purchasePrice, undefined);
  r = await api("GET", `/api/posSales/${S.sale1._id}`, { token: S.manager });
  assert.equal(r.data.sale.totalProfit, 3500 - 100 - (3 * 800 + 300)); // subtotal - discount - cost, tax excluded
  assert.equal((await api("GET", "/api/posSales/not-an-id", { token: S.staff })).status, 400);
  assert.equal((await api("GET", "/api/posSales/507f1f77bcf86cd799439011", { token: S.staff })).status, 404);
});

test("19 cancel: manager only, restores stock exactly once, double-cancel refused", async () => {
  const before = await qtyOf(S.p1._id);
  assert.equal((await api("PUT", `/api/posSales/cancel/${S.creditSale._id}`, { token: S.staff, body: {} })).status, 403);
  const a = await api("PUT", `/api/posSales/cancel/${S.creditSale._id}`, { token: S.manager, body: { reason: "Customer returned" } });
  assert.equal(a.status, 200);
  const b = await api("PUT", `/api/posSales/cancel/${S.creditSale._id}`, { token: S.admin, body: {} });
  assert.equal(b.status, 409);
  assert.equal(await qtyOf(S.p1._id), before + 1); // restored ONCE
  const d = await api("GET", `/api/posSales/${S.creditSale._id}`, { token: S.manager });
  assert.equal(d.data.sale.status, "Cancelled"); assert.equal(d.data.sale.paymentStatus, "Refunded");
  assert.equal(d.data.sale.cancelReason, "Customer returned");
  assert.equal((await api("PUT", `/api/posSales/cancel/507f1f77bcf86cd799439011`, { token: S.manager, body: {} })).status, 404);
});

test("19b (needs atomic engine) two simultaneous cancels: exactly one wins, stock restored once", async (t) => {
  if (!ATOMIC) return t.skip("engine is not atomic");
  const sale = (await api("POST", "/api/posSales/create", { token: S.manager, body: { items: [{ product: S.p1._id, quantity: 1 }] } })).data.sale;
  const before = await qtyOf(S.p1._id);
  const res = await Promise.all([api("PUT", `/api/posSales/cancel/${sale._id}`, { token: S.manager, body: {} }), api("PUT", `/api/posSales/cancel/${sale._id}`, { token: S.admin, body: {} })]);
  assert.deepEqual(res.map((r) => r.status).sort(), [200, 409]);
  assert.equal(await qtyOf(S.p1._id), before + 1);
});

// ───────────────────────── dashboard & reports ─────────────────────────
test("20 dashboard numbers match the sales that exist (cancelled excluded), staff get no profit", async () => {
  const all = (await api("GET", "/api/posSales/all?limit=100&status=Completed", { token: S.manager })).data.sales;
  const revenue = all.reduce((s, x) => s + x.grandTotal, 0);
  const profit = all.reduce((s, x) => s + x.totalProfit, 0);
  const due = all.reduce((s, x) => s + x.dueAmount, 0);
  let r = await api("GET", "/api/dashboard/summary", { token: S.manager });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const d = r.data.dashboard;
  assert.equal(d.cards.todayOrders, all.length);
  assert.equal(d.cards.todayRevenue, revenue);
  assert.equal(d.cards.todayProfit, profit);
  assert.equal(d.cards.totalDue, due);
  assert.equal(d.cards.totalInvoices, all.length);
  assert.equal(d.trend.length, 7);
  assert.equal(d.trend[6].revenue, revenue); // today is the last bucket (timezone-aware grouping)
  assert.ok(d.bestSellingProducts.length >= 1 && d.bestSellingProducts[0].name === "Brake Pad Set");
  assert.ok(d.lowStockProducts.some((p) => p.name === "Oil Filter")); // out of stock now
  assert.equal(d.inventory.outOfStock, 1);
  assert.equal(d.inventory.totalProducts, 3);
  r = await api("GET", "/api/dashboard/summary", { token: S.staff });
  assert.equal(r.data.dashboard.cards.todayProfit, null);
  assert.equal(r.data.dashboard.inventory.stockCost, undefined);
  assert.equal(r.data.dashboard.trend[0].profit, undefined);
  r = await api("GET", "/api/dashboard/trend?days=30", { token: S.manager });
  assert.equal(r.data.trend.length, 30);
  r = await api("GET", "/api/dashboard/low-stock", { token: S.staff });
  assert.ok(r.data.products.length >= 1);
});

test("21 reports: summary / profit / products / customers agree with each other; ranges work", async () => {
  const rs = await api("GET", "/api/reports/summary?period=today", { token: S.manager });
  const rp = await api("GET", "/api/reports/profit?period=today", { token: S.manager });
  const rr = await api("GET", "/api/reports/products?period=today", { token: S.manager });
  const rc = await api("GET", "/api/reports/customers?period=today", { token: S.manager });
  const [sum, profit, prods, custs] = [rs.data.summary, rp.data.report, rr.data.report, rc.data.report];
  assert.ok(sum.totalInvoices >= 3);
  assert.equal(sum.cancelledInvoices, 1);
  assert.equal(profit.grossProfit, sum.totalProfit);                      // two different pipelines, same profit
  assert.equal(profit.grandTotal, sum.totalRevenue);
  assert.equal(profit.netRevenue, profit.grossRevenue - profit.totalDiscount);
  assert.equal(profit.totalTax, 50);                                       // tax tracked but not counted as income
  assert.equal(Math.round(prods.reduce((s, p) => s + p.revenue, 0) * 100) / 100, profit.grossRevenue);
  assert.equal(custs.find((c) => c.customerName === "Ali Raza").totalDue, 450);
  assert.ok(sum.paymentMethods.some((m) => m._id === "JazzCash"));
  assert.equal(sum.trend.length > 0, true);
  // custom range: the UI parameter names (startDate/endDate) must be honoured now
  const d = new Date().toISOString().slice(0, 10);
  const inRange = (await api("GET", `/api/reports/summary?period=custom&startDate=${d}&endDate=${d}`, { token: S.manager })).data.summary;
  assert.equal(inRange.totalInvoices, sum.totalInvoices);
  const old = (await api("GET", "/api/reports/summary?period=custom&startDate=2020-01-01&endDate=2020-01-31", { token: S.manager })).data.summary;
  assert.equal(old.totalInvoices, 0);                                      // previously ignored → returned everything
  const yest = (await api("GET", "/api/reports/summary?period=yesterday", { token: S.manager })).data.summary;
  assert.equal(yest.totalInvoices, 0);
  const all = (await api("GET", "/api/reports/summary?period=all", { token: S.manager })).data.summary;
  assert.equal(all.totalInvoices, sum.totalInvoices);
});

// ───────────────────────── orders, notifications, activity ─────────────────────────
test("21b every dashboard/report pipeline, run on the REAL stored documents, matches independent arithmetic", async () => {
  const pipelines = require("../../services/pipelines");
  const { resolveRange } = require("../../helpers/reportDateFilter");
  const sales = await mongoose.connection.db.collection("possales").find({}).toArray();
  const products = await mongoose.connection.db.collection("products").find({}).toArray();
  const run = (pipeline, docs = sales) => new Aggregator(pipeline).run(docs);
  const r2 = (n) => Math.round(n * 100) / 100;
  const done = sales.filter((x) => x.status === "Completed");
  const cost = (x) => x.items.reduce((s, i) => s + i.purchasePrice * i.quantity, 0);
  const profitOf = (x) => x.subtotal - x.discount - cost(x);
  const sum = (arr, f) => r2(arr.reduce((s, x) => s + f(x), 0));
  assert.ok(done.length >= 3 && sales.length > done.length, "need completed AND cancelled sales in the DB");

  // invoice list header + outstanding dues
  const [stats] = run(pipelines.invoiceStats({}));
  assert.deepEqual([stats.invoices, r2(stats.revenue), r2(stats.due), r2(stats.paid)], [done.length, sum(done, (x) => x.grandTotal), sum(done, (x) => x.dueAmount), sum(done, (x) => x.paidAmount)]);
  assert.equal(r2(run(pipelines.outstandingDue())[0].due), sum(done, (x) => x.dueAmount));

  // summary / profit report: same numbers from two different pipelines and from plain JS
  const match = { status: "Completed" };
  const [t] = run(pipelines.summaryTotals(match));
  assert.equal(t.totalInvoices, done.length);
  assert.equal(r2(t.totalRevenue), sum(done, (x) => x.grandTotal));
  assert.equal(r2(t.totalProfit), sum(done, profitOf));
  assert.equal(r2(t.totalTax), sum(done, (x) => x.tax));
  const [p] = run(pipelines.profitReport(match));
  assert.equal(r2(p.grossRevenue - p.totalDiscount - p.totalCost), r2(t.totalProfit)); // tax never counted as profit
  assert.equal(r2(p.totalCost), sum(done, cost));
  assert.ok(t.totalTax > 0, "fixture should include tax so this check is meaningful");

  // payment breakdowns exclude cancelled sales
  const methods = Object.fromEntries(run(pipelines.paymentMethods(match)).map((m) => [m._id, m.count]));
  assert.equal(Object.values(methods).reduce((a, b) => a + b, 0), done.length);
  assert.equal(run(pipelines.paymentStatuses(match)).reduce((a, b) => a + b.total, 0), done.length);

  // product report: revenue/profit per product, cancelled invoices ignored
  const prod = run(pipelines.productReport(match));
  const expectedUnits = {};
  done.forEach((x) => x.items.forEach((i) => { expectedUnits[i.name] = (expectedUnits[i.name] || 0) + i.quantity; }));
  prod.forEach((row) => assert.equal(row.totalSold, expectedUnits[row.productName], row.productName));
  assert.equal(r2(prod.reduce((a, b) => a + b.profit, 0)), r2(p.grossRevenue - p.totalCost));
  assert.ok(prod.every((row, i) => i === 0 || prod[i - 1].totalSold >= row.totalSold));

  // customers: grouped by phone when present, otherwise by name
  const cust = run(pipelines.customerReport(match));
  assert.equal(r2(cust.reduce((a, b) => a + b.totalPurchase, 0)), sum(done, (x) => x.grandTotal));
  const ali = cust.find((c) => c.customerName === "Ali Raza");
  assert.equal(ali.totalDue, 450); assert.equal(ali.invoices, 1);

  // best sellers
  const best = run(pipelines.bestSelling(5));
  assert.equal(best[0].name, Object.entries(expectedUnits).sort((a, b) => b[1] - a[1])[0][0]);

  // "today" per the shop's timezone
  const today = resolveRange({ period: "today" });
  const [d] = run(pipelines.periodTotals(today.start, today.end));
  assert.equal(d.orders, done.length);

  // inventory snapshot + low stock filter on real product documents
  const [inv] = run(pipelines.inventorySnapshot(), products);
  const active = products.filter((x) => x.status === "Active");
  assert.equal(inv.totalProducts, products.length);
  assert.equal(inv.outOfStock, active.filter((x) => x.quantity <= 0).length);
  assert.equal(inv.lowStock, active.filter((x) => x.quantity > 0 && x.quantity <= x.reorderLevel).length);
  assert.equal(r2(inv.stockCost), r2(products.reduce((s, x) => s + x.purchasePrice * x.quantity, 0)));
  const lowQuery = new Query({ status: "Active", $expr: { $lte: ["$quantity", "$reorderLevel"] } });
  assert.equal(lowQuery.find(products).all().length, active.filter((x) => x.quantity <= x.reorderLevel).length);

  // day buckets follow the shop timezone: 01:00 PKT on the 18th is still the 17th in UTC
  const edge = [{ status: "Completed", createdAt: new Date("2026-10-17T20:00:00Z"), grandTotal: 10, subtotal: 10, discount: 0, items: [] },
                { status: "Completed", createdAt: new Date("2026-10-17T18:59:00Z"), grandTotal: 5, subtotal: 5, discount: 0, items: [] }];
  const buckets = Object.fromEntries(run(pipelines.dailyTrend({ start: new Date("2026-10-16T00:00:00Z"), end: new Date("2026-10-19T00:00:00Z"), timezone: "Asia/Karachi" }), edge).map((b) => [b._id, b.revenue]));
  assert.deepEqual(buckets, { "2026-10-18": 10, "2026-10-17": 5 });
});

test("22 orders: create reserves stock, status update, delete returns stock", async () => {
  const before = await qtyOf(S.p1._id);
  let r = await api("POST", "/api/order/createorder", { token: S.manager, body: { Description: "Hamza weekly", Product: { product: S.p1._id, quantity: 2, price: 950 } } });
  assert.equal(r.status, 201, JSON.stringify(r.data)); S.order = r.data.order;
  assert.equal(r.data.order.totalAmount, 1900);
  assert.equal(await qtyOf(S.p1._id), before - 2);
  r = await api("GET", "/api/order/getorders", { token: S.manager });
  assert.equal(r.data[0].Product.product.name, "Brake Pad Set"); // populates (was a corrupted field name before)
  r = await api("PUT", `/api/order/updatestatusOrder/${S.order._id}`, { token: S.manager, body: { status: "shipped" } });
  assert.equal(r.data.order.status, "shipped");
  assert.equal((await api("PUT", `/api/order/updatestatusOrder/${S.order._id}`, { token: S.manager, body: { status: "bogus" } })).status, 400);
  assert.equal((await api("POST", "/api/order/createorder", { token: S.manager, body: { Description: "too many", Product: { product: S.p1._id, quantity: 9999, price: 1 } } })).status, 409);
  r = await api("GET", "/api/order/graphstatusorder", { token: S.manager });
  assert.equal(r.data[0].count, 1);
  assert.equal((await api("DELETE", `/api/order/removeorder/${S.order._id}`, { token: S.manager })).status, 200);
  assert.equal(await qtyOf(S.p1._id), before); // stock returned
});

test("23 notifications: post announcement, per-user read state, staff can't post", async () => {
  assert.equal((await api("POST", "/api/notification/createNotification", { token: S.staff, body: { name: "x", type: "y" } })).status, 403);
  let r = await api("POST", "/api/notification/createNotification", { token: S.manager, body: { name: "Eid timings", type: "Closed on Eid" } });
  assert.equal(r.status, 201, JSON.stringify(r.data)); const id = r.data.notification._id;
  r = await api("GET", "/api/notification/allNotification", { token: S.staff });
  assert.equal(r.data[0].read, false);
  assert.equal((await api("PUT", `/api/notification/${id}/readNotification`, { token: S.staff })).status, 200);
  assert.equal((await api("GET", "/api/notification/allNotification", { token: S.staff })).data[0].read, true);   // read for staff…
  assert.equal((await api("GET", "/api/notification/allNotification", { token: S.manager })).data[0].read, false); // …still unread for manager
  r = await api("GET", "/api/notification/unreadNotification", { token: S.manager });
  assert.equal(r.data.unreadNotifications.length, 1);
  await api("PUT", "/api/notification/readAll", { token: S.manager });
  assert.equal((await api("GET", "/api/notification/unreadNotification", { token: S.manager })).data.unreadNotifications.length, 0);
});

test("24 activity log is mounted, filtered, populated and read-only", async () => {
  let r = await api("GET", "/api/activitylogs/getAllLogs?limit=100", { token: S.manager });
  assert.equal(r.status, 200);
  const actions = r.data.logs.map((l) => l.action);
  for (const a of ["POS Sale", "Cancel POS Sale", "Add Product", "Stock-in", "Add Supplier", "Create User", "Post Announcement", "Create Order"]) assert.ok(actions.includes(a), `missing log: ${a}`);
  assert.ok(r.data.logs[0].userId.name);
  r = await api("GET", "/api/activitylogs/getAllLogs?entity=pos&query=cancel", { token: S.manager });
  assert.equal(r.data.logs.length, 1);
  assert.equal((await api("GET", "/api/activitylogs/getAllLogs", { token: S.staff })).status, 403);
  assert.equal((await api("GET", `/api/activitylogs/getLogs/${S.managerId}`, { token: S.staff })).status, 403); // can't read others' logs
  assert.equal((await api("GET", `/api/activitylogs/getLogs/${S.staffId}`, { token: S.staff })).status, 200);
  assert.equal((await api("POST", "/api/activitylogs/addLog", { token: S.admin, body: {} })).status, 404);     // forging logs removed
});

// ───────────────────────── imports ─────────────────────────
const xlsxBuffer = (rows) => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "S"); return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }); };
const upload = (path, buf, name = "f.xlsx", token = S.manager) => { const f = new FormData(); f.append("file", new Blob([buf]), name); return api("POST", path, { token, form: f }); };

test("25 product import: template download, add/update/skip report, bad file types", async () => {
  const tpl = await api("GET", "/api/product/template", { token: S.manager });
  assert.equal(tpl.status, 200); assert.ok(tpl.data.length > 1000);
  const r = await upload("/api/product/uploadproducts", xlsxBuffer([
    { name: "Wiper Blade", Category: "Brakes", purchasePrice: 300, sellingPrice: 450, quantity: 12, sku: 123456 },          // numeric sku (old code crashed)
    { name: "Brake Pad Set", Category: "Brakes", purchasePrice: 800, sellingPrice: 1200, quantity: 4 },                      // update existing
    { name: "Ghost", Category: "Nope", purchasePrice: 1, sellingPrice: 2, quantity: 1 },                                     // unknown category
    { name: "Broken", Category: "Brakes", purchasePrice: "abc", sellingPrice: 2, quantity: 1 },                              // bad number
    { name: "Wiper Blade", Category: "Brakes", purchasePrice: 1, sellingPrice: 2, quantity: 1 },                            // duplicate in file
  ]));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual([r.data.summary.inserted, r.data.summary.updated, r.data.summary.skipped], [1, 1, 3]);
  assert.deepEqual(r.data.skippedProducts.map((s) => s.row), [4, 5, 6]);
  const list = (await api("GET", "/api/product/getproduct?limit=100", { token: S.manager })).data.Products;
  assert.equal(list.find((p) => p.name === "Wiper Blade").sku, "123456");
  assert.equal(list.find((p) => p.name === "Brake Pad Set").sellingPrice, 1200);
  assert.equal((await upload("/api/product/uploadproducts", Buffer.from("hi"), "evil.exe")).status, 400);
  assert.equal((await upload("/api/product/uploadproducts", xlsxBuffer([{ foo: 1 }]))).status, 400); // missing columns
  assert.equal((await upload("/api/product/uploadproducts", xlsxBuffer([{ name: "x" }]), "f.xlsx", S.staff)).status, 403);
});

test("26 category import", async () => {
  const r = await upload("/api/category/uploadcategories", xlsxBuffer([{ name: "Lubricants", description: "Oils" }, { name: "Brakes", description: "Updated" }, { name: "", description: "x" }]));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual([r.data.summary.inserted, r.data.summary.updated, r.data.summary.skipped], [1, 1, 1]);
});

// ───────────────────────── account management ─────────────────────────
test("27 profile: change password (old one stops working), validation", async () => {
  assert.equal((await api("PUT", "/api/auth/changePassword", { token: S.staff, body: { currentPassword: "wrong", newPassword: "NewPassw0rd1" } })).status, 400);
  assert.equal((await api("PUT", "/api/auth/changePassword", { token: S.staff, body: { currentPassword: "Passw0rdSam", newPassword: "weak" } })).status, 400);
  assert.equal((await api("PUT", "/api/auth/changePassword", { token: S.staff, body: { currentPassword: "Passw0rdSam", newPassword: "NewPassw0rd1" } })).status, 200);
  assert.equal((await login("sam@shop.pk", "Passw0rdSam")).status, 401);
  assert.equal((await login("sam@shop.pk", "NewPassw0rd1")).status, 200);
  const r = await api("PUT", "/api/auth/updateProfile", { token: S.staff, body: { name: "Samuel Staff" } });
  assert.equal(r.data.updatedUser.name, "Samuel Staff");
  assert.equal((await api("PUT", "/api/auth/updateProfile", { token: S.staff, body: { ProfilePic: "javascript:alert(1)" } })).status, 400);
});

test("28 user admin: role change takes effect immediately; deactivate blocks login & API; last-admin and self protections", async () => {
  let r = await api("PUT", `/api/auth/users/${S.staffId}/role`, { token: S.admin, body: { role: "manager" } });
  assert.equal(r.status, 200);
  assert.equal((await api("GET", "/api/activitylogs/getAllLogs", { token: S.staff })).status, 200); // same token, new role, no re-login needed
  await api("PUT", `/api/auth/users/${S.staffId}/role`, { token: S.admin, body: { role: "staff" } });
  assert.equal((await api("PUT", `/api/auth/users/${S.adminId}/role`, { token: S.admin, body: { role: "staff" } })).status, 400);       // self
  assert.equal((await api("PUT", `/api/auth/users/${S.adminId}/active`, { token: S.admin, body: { active: false } })).status, 400);       // self
  assert.equal((await api("DELETE", `/api/auth/removeuser/${S.adminId}`, { token: S.admin })).status, 400);                              // self
  r = await api("PUT", `/api/auth/users/${S.staffId}/active`, { token: S.admin, body: { active: false } });
  assert.equal(r.status, 200);
  assert.equal((await api("GET", "/api/auth/me", { token: S.staff })).status, 403);   // deactivated mid-session
  assert.equal((await login("sam@shop.pk", "NewPassw0rd1")).status, 403);
  await api("PUT", `/api/auth/users/${S.staffId}/active`, { token: S.admin, body: { active: true } });
  assert.equal((await login("sam@shop.pk", "NewPassw0rd1")).status, 200);
  // promote manager to admin, then the original admin may be demoted by the new one — but never the last admin
  await api("PUT", `/api/auth/users/${S.managerId}/role`, { token: S.admin, body: { role: "admin" } });
  assert.equal((await api("PUT", `/api/auth/users/${S.adminId}/role`, { token: S.manager, body: { role: "staff" } })).status, 200);
  assert.equal((await api("DELETE", `/api/auth/removeuser/${S.adminId}`, { token: S.manager })).status, 200);
  assert.equal((await api("GET", "/api/auth/me", { token: S.admin })).status, 401); // deleted user's token is dead
});

test("29 deleting a product keeps old invoices intact (snapshots)", async () => {
  const detail = (await api("GET", `/api/posSales/${S.sale1._id}`, { token: S.manager })).data.sale;
  assert.equal((await api("DELETE", `/api/product/removeproduct/${S.p1._id}`, { token: S.manager })).status, 200);
  const after = (await api("GET", `/api/posSales/${S.sale1._id}`, { token: S.manager })).data.sale;
  assert.equal(after.items[0].name, detail.items[0].name);
  assert.equal(after.grandTotal, detail.grandTotal);
  // reports still work with a deleted product
  const rp = await api("GET", "/api/reports/products?period=all", { token: S.manager });
  assert.equal(rp.status, 200);
});

test("30 logout clears the cookie with matching attributes", async () => {
  const r = await api("POST", "/api/auth/logout");
  assert.equal(r.status, 200);
  const c = r.headers.get("set-cookie") || "";
  assert.match(c, /Inventorymanagmentsystem=;/); assert.match(c, /Expires=Thu, 01 Jan 1970/);
});
