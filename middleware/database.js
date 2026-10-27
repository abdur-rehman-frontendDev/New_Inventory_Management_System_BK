const { MongoDBconfig } = require("../libs/mongoconfig");

module.exports = async (req, res, next) => {
  try {
    await MongoDBconfig();
    next();
  } catch (err) {
    res.status(503).json({ success: false, message: "Database unavailable. Please try again shortly." });
  }
};
