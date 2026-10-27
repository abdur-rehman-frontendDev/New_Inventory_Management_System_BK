const config = require("./config/env");
const app = require("./api/index");
const { MongoDBconfig } = require("./libs/mongoconfig");

if (!config.jwtSecret) {
  console.error("✖ JWT_SECRET (or legacy SecretKey) is not set. Refusing to start.");
  process.exit(1);
}

const start = async () => {
  try {
    await MongoDBconfig();
    console.log("✅ MongoDB connected");
  } catch (err) {
    console.error("✖ Could not connect to MongoDB:", err.message);
    process.exit(1);
  }
  const server = app.listen(config.port, () => console.log(`🚀 Server running on port ${config.port}`));

  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
};

process.on("unhandledRejection", (reason) => console.error("Unhandled rejection:", reason));

start();
