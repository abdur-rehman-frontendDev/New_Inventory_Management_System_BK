const { z, objectId, money, qty, text } = require("./common");

const phone = z
  .string()
  .trim()
  .max(30)
  .regex(/^[0-9+\-()\s]*$/, "Phone can only contain digits, spaces, + - ( )")
  .optional()
  .default("");

module.exports = {
  create: z.object({
    customerName: text(100).optional().default(""),
    customerPhone: phone,
    paymentMethod: z.enum(["Cash", "Card", "Bank", "JazzCash", "EasyPaisa"]).optional().default("Cash"),
    discount: money("Discount").optional().default(0),
    tax: money("Tax").optional().default(0),
    paidAmount: money("Paid amount").optional().default(0),
    notes: text(500).optional().default(""),
    items: z
      .array(z.object({ product: objectId, quantity: qty() }))
      .min(1, "Please add at least one product.")
      .max(200, "Too many line items."),
  }),
  cancel: z.object({ reason: text(300).optional().default("") }),
};
