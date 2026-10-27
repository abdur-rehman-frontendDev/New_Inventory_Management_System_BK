const AppError = require("./AppError");

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Single source of truth for sale maths. Everything is derived on the server – the client only
 * says *what* is sold and *how much* it paid; it never decides totals or payment status.
 *
 * items: [{ unitPrice, purchasePrice, quantity }]
 *
 * profit = (subtotal - discount) - cost   → tax is a liability, never profit
 */
const computeSaleTotals = ({ items, discount = 0, tax = 0, paidAmount = 0 }) => {
  const subtotal = round2(items.reduce((s, i) => s + i.unitPrice * i.quantity, 0));
  const totalCost = round2(items.reduce((s, i) => s + i.purchasePrice * i.quantity, 0));

  const discountAmt = round2(num(discount));
  const taxAmt = round2(num(tax));
  const tendered = round2(num(paidAmount));

  if (discountAmt < 0 || taxAmt < 0 || tendered < 0) {
    throw new AppError(400, "Discount, tax and paid amount cannot be negative.");
  }
  if (discountAmt > subtotal) {
    throw new AppError(400, "Discount cannot be greater than the subtotal.");
  }

  const grandTotal = round2(subtotal - discountAmt + taxAmt);
  const paid = round2(Math.min(tendered, grandTotal));
  const dueAmount = round2(Math.max(grandTotal - tendered, 0));
  const changeAmount = round2(Math.max(tendered - grandTotal, 0));

  let paymentStatus = "Pending";
  if (tendered >= grandTotal) paymentStatus = "Paid";
  else if (tendered > 0) paymentStatus = "Partial";

  return {
    subtotal,
    discount: discountAmt,
    tax: taxAmt,
    grandTotal,
    tenderedAmount: tendered,
    paidAmount: paid,
    dueAmount,
    changeAmount,
    paymentStatus,
    totalCost,
    totalProfit: round2(subtotal - discountAmt - totalCost),
  };
};

module.exports = { round2, num, computeSaleTotals };
