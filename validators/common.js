const { z } = require("zod");

const objectId = z.string().trim().regex(/^[a-f\d]{24}$/i, "Invalid id");

/** "" / null / undefined -> undefined, so optional form fields don't fail validation. */
const emptyToUndef = (schema) => z.preprocess((v) => (v === "" || v === null ? undefined : v), schema.optional());

const money = (label = "Amount") =>
  z.coerce.number({ invalid_type_error: `${label} must be a number` }).finite().min(0, `${label} cannot be negative`).max(1e9, `${label} is too large`);

const qty = (label = "Quantity") =>
  z.coerce
    .number({ invalid_type_error: `${label} must be a number` })
    .finite()
    .positive(`${label} must be greater than 0`)
    .max(1e6, `${label} is too large`)
    .refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, `${label} supports up to 3 decimals`);

const text = (max = 200) => z.string().trim().max(max);

module.exports = { z, objectId, emptyToUndef, money, qty, text };
