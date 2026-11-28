require("dotenv").config();

const path = require("node:path");
const express = require("express");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const { connectDatabase } = require("./src/database");
const { apiRouter } = require("./src/routes");

const app = express();
const port = Number(process.env.PORT) || 3000;

app.disable("x-powered-by");
if (process.env.TRUST_PROXY_HOPS !== undefined) {
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS);
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0) {
    throw new Error("TRUST_PROXY_HOPS must be a non-negative integer.");
  }
  app.set("trust proxy", trustProxyHops);
}
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests:
          process.env.NODE_ENV === "production" ? [] : null,
      },
    },
  }),
);
app.use(
  express.json({
    limit: "32kb",
    verify(req, res, buffer) {
      if (req.path === "/api/billing/webhook") {
        req.rawBody = Buffer.from(buffer);
      }
    },
  }),
);
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));
app.use("/api", apiRouter);

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Endpoint not found." });
  }
  return res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Request body must be valid JSON." });
  }
  if (
    err.code === 20 &&
    /transaction numbers are only allowed|replica set/i.test(err.message)
  ) {
    return res.status(503).json({
      error: "Wallet and order transactions require MongoDB Atlas or a replica set.",
    });
  }
  console.error("Request failed:", err.message);
  return res.status(500).json({ error: "Something went wrong." });
});

async function start() {
  validateEnvironment();
  await connectDatabase();
  app.listen(port, () => {
    console.log(`SocialX is running at http://localhost:${port}`);
  });
}

function validateEnvironment() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must be set to a random value of at least 32 characters.");
  }
}

if (require.main === module) {
  start().catch((error) => {
    console.error("Unable to start SocialX:", error.message);
    process.exitCode = 1;
  });
}

module.exports = { app, validateEnvironment };
