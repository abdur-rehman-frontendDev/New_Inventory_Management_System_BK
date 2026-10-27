const { z, objectId, text } = require("./common");

const contact = z
  .object({
    phone: text(30).optional().default(""),
    email: z.union([z.literal(""), z.string().trim().toLowerCase().email("Enter a valid supplier email")]).optional().default(""),
    address: text(250).optional().default(""),
  })
  .default({});

const products = z.preprocess(
  (v) => (v === undefined || v === null || v === "" ? [] : Array.isArray(v) ? v : [v]),
  z.array(objectId).max(500),
);

const create = z.object({
  name: text(120).min(1, "Supplier name is required"),
  contactInfo: contact,
  productsSupplied: products.default([]),
});

const update = z.object({
  name: text(120).min(1).optional(),
  contactInfo: contact.optional(),
  productsSupplied: products.optional(),
});

module.exports = { create, update };
