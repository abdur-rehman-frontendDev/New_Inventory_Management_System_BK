const test = require("node:test");
const assert = require("node:assert/strict");
const auth = require("../validators/auth");
const product = require("../validators/product");
const pos = require("../validators/pos");
const supplier = require("../validators/supplier");

const id = "507f1f77bcf86cd799439011";

test("signup ignores a client-supplied role (privilege escalation fix)", () => {
  const r = auth.signup.parse({ name: "Eve", email: "EVE@Mail.com ", password: "abcdef12", role: "admin" });
  assert.equal(r.role, undefined);
  assert.equal(r.email, "eve@mail.com");
});

test("password policy", () => {
  assert.equal(auth.signup.safeParse({ name: "Eve", email: "e@e.com", password: "short1" }).success, false);
  assert.equal(auth.signup.safeParse({ name: "Eve", email: "e@e.com", password: "allletters" }).success, false);
});

test("login rejects object email (NoSQL injection)", () => {
  assert.equal(auth.login.safeParse({ email: { $ne: null }, password: "x" }).success, false);
});

test("product create validates and defaults", () => {
  const p = product.create.parse({ name: " Pad ", Category: id, purchasePrice: "10", sellingPrice: 15 });
  assert.equal(p.name, "Pad");
  assert.equal(p.quantity, 0);
  assert.equal(p.reorderLevel, 5);
  assert.equal(product.create.safeParse({ name: "x", Category: id, purchasePrice: -1, sellingPrice: 1 }).success, false);
  assert.equal(product.create.safeParse({ name: "x", Category: id, purchasePrice: 1, sellingPrice: 1, status: "Out of Stock" }).success, false);
});

test("product update: whitelist + legacy shape + no mass assignment", () => {
  const r = product.update.parse({ productId: id, updatedData: { name: "N", createdBy: "evil", _id: "x", sellingPrice: 5 } });
  assert.deepEqual(r, { name: "N", sellingPrice: 5 });
});

test("product list tolerates empty params", () => {
  const q = product.listQuery.parse({ page: "2", status: "", stock: "", query: "" });
  assert.equal(q.page, 2);
  assert.equal(q.status, undefined);
});

test("pos: negative / zero quantity can never increase stock", () => {
  const base = { items: [{ product: id, quantity: -5 }] };
  assert.equal(pos.create.safeParse(base).success, false);
  assert.equal(pos.create.safeParse({ items: [{ product: id, quantity: 0 }] }).success, false);
  assert.equal(pos.create.safeParse({ items: [] }).success, false);
  assert.equal(pos.create.safeParse({ items: [{ product: id, quantity: 1.5 }] }).success, true);
  assert.equal(pos.create.safeParse({ items: [{ product: id, quantity: 1.00001 }] }).success, false);
});

test("pos: client-sent paymentStatus / dueAmount are dropped", () => {
  const r = pos.create.parse({ items: [{ product: id, quantity: 1 }], paymentStatus: "Paid", dueAmount: -100 });
  assert.equal(r.paymentStatus, undefined);
  assert.equal(r.dueAmount, undefined);
});

test("supplier accepts single id or array of products", () => {
  assert.deepEqual(supplier.create.parse({ name: "S", productsSupplied: id }).productsSupplied, [id]);
  assert.deepEqual(supplier.create.parse({ name: "S" }).productsSupplied, []);
});
