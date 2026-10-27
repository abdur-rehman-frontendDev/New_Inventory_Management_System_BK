const { z, text } = require("./common");

const create = z.object({
  name: text(80).min(1, "Category name is required"),
  description: text(500).optional().default(""),
});

const update = z.object({ name: text(80).min(1, "Category name is required"), description: text(500) }).partial();

module.exports = { create, update };
