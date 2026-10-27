/**
 * Staff members run the till but must not see what the shop pays for goods or how much it earns.
 * These helpers strip cost / profit fields from API responses for the `staff` role.
 */
const canSeeCost = (role) => role === "admin" || role === "manager";

const toObj = (doc) => (doc && typeof doc.toObject === "function" ? doc.toObject() : doc);

const product = (doc, role) => {
  const p = toObj(doc);
  if (!p || canSeeCost(role)) return p;
  const { purchasePrice, ...rest } = p;
  return rest;
};

const products = (docs, role) => (docs || []).map((d) => product(d, role));

const sale = (doc, role) => {
  const s = toObj(doc);
  if (!s || canSeeCost(role)) return s;
  const { totalProfit, ...rest } = s;
  if (Array.isArray(rest.items)) {
    rest.items = rest.items.map((i) => {
      const { purchasePrice, ...item } = toObj(i);
      return item;
    });
  }
  return rest;
};

const sales = (docs, role) => (docs || []).map((d) => sale(d, role));

module.exports = { canSeeCost, product, products, sale, sales };
