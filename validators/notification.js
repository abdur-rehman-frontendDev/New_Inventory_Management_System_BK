const { z, text } = require("./common");

module.exports = {
  create: z.object({ name: text(120).min(1, "Title is required"), type: text(600).min(1, "Message is required") }),
};
