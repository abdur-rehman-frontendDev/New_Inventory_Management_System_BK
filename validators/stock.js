const { z, objectId, emptyToUndef, qty, text } = require("./common");

module.exports = {
  create: z.object({
    product: objectId,
    type: z.enum(["Stock-in", "Stock-out"]),
    quantity: qty(),
    supplier: emptyToUndef(objectId),
    note: text(300).optional().default(""),
  }),
};
