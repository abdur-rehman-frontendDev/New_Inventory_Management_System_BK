const rateLimit = require("express-rate-limit");

const make = (opts) =>
  rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) =>
      res.status(429).json({ success: false, message: "Too many attempts. Please wait a few minutes and try again." }),
    ...opts,
  });

/** Brute-force protection for login / signup (per IP). */
const authLimiter = make({ windowMs: 15 * 60 * 1000, max: 20 });

/** Generic safety net for the whole API. */
const apiLimiter = make({
  windowMs: 60 * 1000,
  max: 600,
  handler: (req, res) => res.status(429).json({ success: false, message: "Too many requests. Slow down." }),
});

module.exports = { authLimiter, apiLimiter };
