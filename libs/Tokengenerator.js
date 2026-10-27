const jwt = require("jsonwebtoken");
const { jwtSecret, jwtExpiresIn, cookieName, cookieOptions } = require("../config/env");

/** Signs a JWT, sets it as an httpOnly cookie and returns it (also used as a Bearer fallback). */
const generateToken = async (user, res) => {
  if (!jwtSecret) throw new Error("JWT_SECRET (or legacy SecretKey) is not defined in the environment.");

  const token = jwt.sign({ userId: user._id, role: user.role }, jwtSecret, { expiresIn: jwtExpiresIn });
  res.cookie(cookieName, token, cookieOptions);
  return token;
};

module.exports = generateToken;
