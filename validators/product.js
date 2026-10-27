const { z, objectId, emptyToUndef, money, text } = require("./common");

const base = {
  name: text(160).min(1, "Product name is required"),
  Category: objectId,
  Description: text(1000).optional().default(""),
  brand: text(80).optional().default(""),
  unit: text(30).optional().default("Piece"),
  purchasePrice: money("Purchase price"),
  sellingPrice: money("Selling price"),
  quantity: money("Quantity").default(0),
  reorderLevel: money("Reorder level").default(5),
  status: z.enum(["Active", "Inactive"]).default("Active"),
  sku: emptyToUndef(text(60)),
  barcode: emptyToUndef(text(60)),
};

const create = z.object(base);

// Updates accept both `{ ...fields }` and the legacy `{ productId, updatedData: { ...fields } }` shape.
const update = z.preprocess(
  (v) => (v && typeof v === "object" && v.updatedData ? v.updatedData : v),
  z
    .object({
      name: base.name,
      Category: base.Category,
      Description: z.string().trim().max(1000),
      brand: z.string().trim().max(80),
      unit: z.string().trim().max(30),
      purchasePrice: base.purchasePrice,
      sellingPrice: base.sellingPrice,
      quantity: money("Quantity"),
      reorderLevel: money("Reorder level"),
      status: z.enum(["Active", "Inactive"]),
      sku: z.string().trim().max(60),
      barcode: z.string().trim().max(60),
    })
    .partial(),
);

const dropEmpty = (v) =>
  v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([, val]) => val !== "")) : v;

const listQuery = z.preprocess(dropEmpty, z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).optional(), // capped to 100 by the paginator
  query: z.string().trim().max(100).optional(),
  status: z.enum(["Active", "Inactive"]).optional(),
  stock: z.enum(["low", "out", "in"]).optional(),
  category: objectId.optional(),
  sort: z.enum(["newest", "oldest", "name", "stock-asc", "stock-desc", "price-asc", "price-desc"]).optional(),
}));

module.exports = { create, update, listQuery };
