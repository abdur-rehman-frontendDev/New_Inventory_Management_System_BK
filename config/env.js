require("dotenv").config();

const isProd = process.env.NODE_ENV === "production";

// `SecretKey` is the legacy variable name – still supported so existing deployments keep working.
const jwtSecret = process.env.JWT_SECRET || process.env.SecretKey;

const list = (value, fallback) =>
  (value || fallback)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const config = {
  isProd,
  port: Number(process.env.PORT) || 5000,
  mongoUrl: process.env.MONGODB_URL,
  jwtSecret,
  jwtExpiresIn: "7d",
  cookieName: "Inventorymanagmentsystem",
  allowPublicSignup: String(process.env.ALLOW_PUBLIC_SIGNUP).toLowerCase() === "true",
  timezone: process.env.APP_TIMEZONE || "Asia/Karachi",
  corsOrigins: list(
    process.env.CORS_ORIGINS,
    "http://localhost:5173,http://localhost:3000,https://mumeez-inventory.vercel.app",
  ),
  cloudinary: {
    cloud_name: process.env.CLOUD_NAME,
    api_key: process.env.API_KEY,
    api_secret: process.env.API_SECRET,
  },
};

// Cross-site cookies (Vercel frontend -> Vercel backend) need SameSite=None + Secure.
// On plain-http localhost that would be rejected, so relax it outside production.
config.cookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? "none" : "lax",
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: "/",
};

module.exports = config;
