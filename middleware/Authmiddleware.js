const jwt = require("jsonwebtoken");
const User = require("../models/Usermodel");
const AppError = require("../helpers/AppError");
const asyncHandler = require("../helpers/asyncHandler");
const { jwtSecret, cookieName } = require("../config/env");

const extractToken = (req) => {
  if (req.cookies && req.cookies[cookieName]) return req.cookies[cookieName];
  const header = req.headers.authorization;
  if (header && /^Bearer\s+/i.test(header)) return header.replace(/^Bearer\s+/i, "").trim();
  return null;
};

/** Verifies the JWT and loads the *current* user from the database (so role changes apply instantly). */
const authmiddleware = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) throw new AppError(401, "Unauthorized: No token provided.");

  let decoded;
  try {
    decoded = jwt.verify(token, jwtSecret);
  } catch (err) {
    throw new AppError(401, "Unauthorized: Invalid or expired token.");
  }
  if (!decoded?.userId) throw new AppError(401, "Unauthorized: Invalid token.");

  const user = await User.findById(decoded.userId).select("-password");
  if (!user) throw new AppError(401, "Unauthorized: User not found.");
  if (user.active === false) throw new AppError(403, "This account has been deactivated.");

  req.user = user;
  next();
});

/** Role gate. Usage: router.post("/x", authmiddleware, authorize("admin", "manager"), handler) */
const authorize =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) return next(new AppError(401, "Unauthorized."));
    if (!roles.includes(req.user.role)) {
      return next(new AppError(403, `Access denied. ${roles.join(" or ")} role required.`));
    }
    next();
  };

// Backwards-compatible names used by the previous routers
const adminmiddleware = authorize("admin");
const managermiddleware = authorize("manager");

module.exports = { authmiddleware, authorize, adminmiddleware, managermiddleware, extractToken };
