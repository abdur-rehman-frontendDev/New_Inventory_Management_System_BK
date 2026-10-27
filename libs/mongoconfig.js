const mongoose = require("mongoose");
const { mongoUrl } = require("../config/env");

// Cache the connection across serverless invocations (Vercel) and hot reloads.
let cached = global.__mongoose;
if (!cached) cached = global.__mongoose = { conn: null, promise: null };

async function MongoDBconfig() {
  if (!mongoUrl) throw new Error("MONGODB_URL is missing");
  if (cached.conn && mongoose.connection.readyState === 1) return cached.conn;

  if (!cached.promise) {
    mongoose.set("bufferCommands", false);
    cached.promise = mongoose.connect(mongoUrl, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 8000,
      socketTimeoutMS: 45000,
    });
  }

  try {
    cached.conn = await cached.promise;
    return cached.conn;
  } catch (err) {
    cached.promise = null;
    cached.conn = null;
    console.error("MongoDB Connection Error:", err.message);
    throw err;
  }
}

module.exports = { MongoDBconfig };
