const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");

const config = require("../config/env");
const databaseMiddleware = require("../middleware/database");
const sanitize = require("../middleware/sanitize");
const { notFound, errorHandler } = require("../middleware/errorHandler");
const { apiLimiter } = require("../middleware/rateLimiters");

const app = express();

// Vercel / proxies: needed for correct client IPs (rate limiting, audit log).
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

// CORS goes FIRST so even error responses (e.g. DB down) carry CORS headers and preflights never hit the DB.
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// Profile pictures arrive as base64, everything else is small JSON.
app.use("/api/auth/updateProfile", express.json({ limit: "10mb" }));
app.use(express.json({ limit: "200kb" }));
app.use(cookieParser());
app.use(sanitize);
app.use("/api", apiLimiter);

app.get("/", (req, res) => res.send("Backend Running Successfully"));
app.get("/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use(databaseMiddleware);

app.use("/api/auth", require("../Routers/authRouther"));
app.use("/api/dashboard", require("../Routers/dashboardRouter"));
app.use("/api/product", require("../Routers/ProductRouter"));
app.use("/api/order", require("../Routers/orderRouter"));
app.use("/api/category", require("../Routers/categoryRouter"));
app.use("/api/notification", require("../Routers/notificationRouters"));
app.use("/api/inventory", require("../Routers/inventoryRouter"));
app.use("/api/sales", require("../Routers/salesRouter"));
app.use("/api/supplier", require("../Routers/supplierrouter"));
app.use("/api/stocktransaction", require("../Routers/stocktransactionrouter"));
const posRouter = require("../Routers/posSalesRouter");
app.use("/api/posSales", posRouter);
app.use("/api/pos", posRouter); // the old duplicate POS implementation now shares this one
app.use("/api/reports", require("../Routers/reportsRouter"));
app.use("/api/activitylogs", require("../Routers/activityRouter")); // was never mounted before

app.use(notFound);
app.use(errorHandler);

module.exports = app;
