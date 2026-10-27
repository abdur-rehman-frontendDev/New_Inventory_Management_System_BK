const { z, objectId, money, qty, text } = require("./common");

const status = z.enum(["pending", "shipped", "delivered"]);

module.exports = {
  create: z.object({
    Description: text(500).min(1, "Description is required"),
    Product: z.object({ product: objectId, quantity: qty(), price: money("Price") }),
    status: status.optional().default("pending"),
  }),
  updateStatus: z.object({ status }),
};
