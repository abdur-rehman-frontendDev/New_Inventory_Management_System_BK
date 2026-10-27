process.env.JWT_SECRET = "test-secret";
process.env.APP_TIMEZONE = "Asia/Karachi";
const test = require("node:test");
const assert = require("node:assert/strict");

const { computeSaleTotals } = require("../helpers/money");
const { resolveRange, startOfDay } = require("../helpers/reportDateFilter");
const { escapeRegex } = require("../helpers/regex");
const { clean } = require("../middleware/sanitize");
const serialize = require("../helpers/serializers");
const { mergeLines } = require("../services/saleService");
const { parsePaging } = require("../helpers/pagination");

const items = [
  { unitPrice: 100, purchasePrice: 60, quantity: 2 },
  { unitPrice: 50, purchasePrice: 30, quantity: 1 },
];

test("sale totals: profit excludes tax and respects discount", () => {
  const t = computeSaleTotals({ items, discount: 20, tax: 25, paidAmount: 1000 });
  assert.equal(t.subtotal, 250);
  assert.equal(t.grandTotal, 255); // 250 - 20 + 25
  assert.equal(t.totalProfit, 250 - 20 - (120 + 30)); // 80, tax is not profit
  assert.equal(t.changeAmount, 745);
  assert.equal(t.dueAmount, 0);
  assert.equal(t.paidAmount, 255); // applied amount never exceeds the total
  assert.equal(t.paymentStatus, "Paid");
});

test("sale totals: payment status is derived, not client-supplied", () => {
  assert.equal(computeSaleTotals({ items, paidAmount: 0 }).paymentStatus, "Pending");
  const partial = computeSaleTotals({ items, paidAmount: 100 });
  assert.equal(partial.paymentStatus, "Partial");
  assert.equal(partial.dueAmount, 150);
});

test("sale totals reject nonsense", () => {
  assert.throws(() => computeSaleTotals({ items, discount: 999 }), /Discount/);
  assert.throws(() => computeSaleTotals({ items, tax: -1 }), /negative/);
});

test("timezone: 'today' follows Asia/Karachi, not UTC", () => {
  // 2026-10-17 20:00 UTC == 2026-10-18 01:00 in Karachi
  const now = new Date("2026-10-17T20:00:00Z");
  const r = resolveRange({ period: "today" }, { now });
  assert.equal(r.start.toISOString(), "2026-10-17T19:00:00.000Z");
  assert.equal(r.end.toISOString(), "2026-10-18T19:00:00.000Z");
  assert.equal(startOfDay(new Date("2026-10-17T10:00:00Z")).toISOString(), "2026-10-16T19:00:00.000Z");
});

test("week starts on Monday; yesterday/month work", () => {
  const sat = new Date("2026-10-17T08:00:00Z"); // Saturday
  assert.equal(resolveRange({ period: "week" }, { now: sat }).start.toISOString(), "2026-10-11T19:00:00.000Z"); // Mon 12th PKT
  assert.equal(resolveRange({ period: "month" }, { now: sat }).start.toISOString(), "2026-09-30T19:00:00.000Z"); // 1 Oct PKT
  const y = resolveRange({ period: "yesterday" }, { now: sat });
  assert.equal(y.end.toISOString(), "2026-10-16T19:00:00.000Z");
});

test("custom range accepts startDate/endDate (UI) and from/to (legacy), inclusive of end day", () => {
  const a = resolveRange({ startDate: "2026-10-01", endDate: "2026-10-03" });
  const b = resolveRange({ from: "2026-10-01", to: "2026-10-03" });
  assert.deepEqual(a, b);
  assert.equal(a.start.toISOString(), "2026-09-30T19:00:00.000Z");
  assert.equal(a.end.toISOString(), "2026-10-03T19:00:00.000Z");
  // reversed dates are swapped
  assert.deepEqual(resolveRange({ from: "2026-10-03", to: "2026-10-01" }), a);
  assert.equal(resolveRange({}), null);
});

test("regex input is escaped", () => {
  assert.equal(escapeRegex("a.*(b)+"), "a\\.\\*\\(b\\)\\+");
  assert.ok(new RegExp(escapeRegex("(a+)+$")).test("(a+)+$"));
});

test("sanitize strips mongo operators", () => {
  assert.deepEqual(clean({ email: { $ne: null }, ok: 1, "a.b": 2, nested: [{ $gt: 1, x: 1 }] }), { email: {}, ok: 1, nested: [{ x: 1 }] });
});

test("staff never see cost or profit", () => {
  const sale = { totalProfit: 5, grandTotal: 10, items: [{ name: "x", purchasePrice: 3, unitPrice: 4 }] };
  const staff = serialize.sale(sale, "staff");
  assert.equal(staff.totalProfit, undefined);
  assert.equal(staff.items[0].purchasePrice, undefined);
  assert.equal(serialize.sale(sale, "manager").totalProfit, 5);
  assert.equal(serialize.product({ purchasePrice: 1, name: "p" }, "staff").purchasePrice, undefined);
});

test("duplicate cart lines are merged", () => {
  assert.deepEqual(mergeLines([{ product: "a", quantity: 1 }, { product: "a", quantity: 2 }, { product: "b", quantity: 1 }]), [
    { product: "a", quantity: 3 },
    { product: "b", quantity: 1 },
  ]);
});

test("pagination is capped", () => {
  assert.equal(parsePaging({ limit: "100000" }).limit, 100);
  assert.deepEqual(parsePaging({ page: "-3", limit: "x" }), { page: 1, limit: 10, skip: 0 });
});
