const jwt = require("jsonwebtoken");
const { rateLimit } = require("express-rate-limit");
const { User } = require("./models");

const cookieName = "socialx_session";

function authCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure:
      process.env.NODE_ENV === "production" ||
      process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

async function requireAuth(req, res, next) {
  const token = req.cookies[cookieName];
  if (!token) return res.status(401).json({ error: "Please sign in." });
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET is required.");
    const payload = jwt.verify(token, secret);
    const user = await User.findById(payload.sub).select(
      "_id name username email bio isAdmin isPro walletBalanceMinor",
    );
    if (!user) return res.status(401).json({ error: "Please sign in again." });
    req.user = user;
    req.isAdmin = user.isAdmin === true;
    return next();
  } catch (error) {
    if (error.name === "TokenExpiredError" || error.name === "JsonWebTokenError") {
      res.clearCookie(cookieName, authCookieOptions());
      return res.status(401).json({ error: "Your session has expired." });
    }
    return next(error);
  }
}

function requireAdmin(req, res, next) {
  if (!req.isAdmin) {
    return res.status(403).json({ error: "Admin access is required." });
  }
  return next();
}

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Try again in 15 minutes." },
});

const writeRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "You’re moving a little fast. Try again in a few minutes." },
});

module.exports = {
  authCookieOptions,
  authRateLimit,
  cookieName,
  requireAdmin,
  requireAuth,
  writeRateLimit,
};
