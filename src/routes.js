const crypto = require("node:crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { z } = require("zod");
const {
  Comment,
  EngagementOrder,
  Follow,
  Payment,
  Post,
  Reaction,
  SupportTicket,
  User,
  WalletTransaction,
} = require("./models");
const {
  authCookieOptions,
  authRateLimit,
  cookieName,
  requireAdmin,
  requireAuth,
  writeRateLimit,
} = require("./middleware");
const { calculatePriceMinor, calculatePriceMinorFromUsd, getEngagementPricingConfig } = require("./engagement-pricing");
const { requestProvider, SmmProviderError } = require("./smm-provider");

const apiRouter = express.Router();
const authRouter = express.Router();
const socialRouter = express.Router();
const billingRouter = express.Router();
const engagementRouter = express.Router();
const supportRouter = express.Router();
const adminRouter = express.Router();

const signupSchema = z.object({
  name: z.string().trim().min(2).max(60),
  username: z.string().trim().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/),
  email: z.string().trim().email().max(254),
  password: z
    .string()
    .min(10)
    .max(72)
    .refine((value) => Buffer.byteLength(value, "utf8") <= 72, {
      message: "Password must be no more than 72 bytes.",
    }),
});
const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z
    .string()
    .min(1)
    .max(72)
    .refine((value) => Buffer.byteLength(value, "utf8") <= 72, {
      message: "Password must be no more than 72 bytes.",
    }),
});

function parseBody(schema, req, res) {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({
      error: result.error.issues[0]?.message || "Invalid request.",
    });
    return null;
  }
  return result.data;
}

function publicUser(user, isAdmin = user.isAdmin === true) {
  return {
    id: user._id,
    name: user.name,
    username: user.username,
    bio: user.bio,
    isPro: user.isPro,
    isAdmin,
  };
}

function validId(value) {
  return mongoose.isObjectIdOrHexString(value);
}

function getProPlanConfig() {
  const rawAmount = process.env.SQUAD_PRO_PLAN_AMOUNT_MINOR;
  const amount = rawAmount === undefined ? 500000 : Number(rawAmount);
  const currency = (process.env.SQUAD_CURRENCY || "NGN").toUpperCase();
  if (!Number.isSafeInteger(amount) || amount < 1) {
    throw new Error("SQUAD_PRO_PLAN_AMOUNT_MINOR must be a positive integer.");
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error("SQUAD_CURRENCY must be a three-letter currency code.");
  }
  return { amount, currency };
}

function getWalletTopupLimits() {
  const minimum = Number(process.env.WALLET_MIN_TOPUP_MINOR || 10000);
  const maximum = Number(process.env.WALLET_MAX_TOPUP_MINOR || 10000000);
  if (
    !Number.isSafeInteger(minimum) ||
    !Number.isSafeInteger(maximum) ||
    minimum < 1 ||
    maximum < minimum
  ) {
    throw new Error("Wallet top-up limits are misconfigured.");
  }
  return { minimum, maximum };
}

function getSquadApiBaseUrl() {
  return (process.env.SQUAD_BASE_URL || "https://sandbox-api-d.squadco.com").replace(
    /\/$/,
    "",
  );
}

function isValidSquadSignature(signature, rawBody, secret) {
  if (
    typeof signature !== "string" ||
    !/^[a-f0-9]{128}$/i.test(signature) ||
    !Buffer.isBuffer(rawBody)
  ) {
    return false;
  }
  const expected = crypto.createHmac("sha512", secret).update(rawBody).digest();
  const received = Buffer.from(signature, "hex");
  return crypto.timingSafeEqual(expected, received);
}

function verifiedTransactionMatchesPayment(transaction, payment) {
  const reference = transaction?.transaction_ref || transaction?.reference;
  const amount = Number(transaction?.transaction_amount ?? transaction?.amount);
  const currency =
    transaction?.transaction_currency_id ||
    transaction?.transaction_currency ||
    transaction?.currency;
  return (
    String(transaction?.transaction_status || transaction?.status).toLowerCase() ===
      "success" &&
    reference === payment.reference &&
    Number.isSafeInteger(amount) &&
    amount === payment.amount &&
    typeof currency === "string" &&
    currency.toUpperCase() === payment.currency.toUpperCase()
  );
}

async function fetchSquadTransaction(reference) {
  const response = await fetch(
    `${getSquadApiBaseUrl()}/transaction/verify/${encodeURIComponent(reference)}`,
    {
      headers: { Authorization: `Bearer ${process.env.SQUAD_SECRET_KEY}` },
      signal: AbortSignal.timeout(10000),
    },
  );
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function markPaymentSuccessful(payment) {
  if (payment.purpose !== "wallet") {
    await Payment.updateOne(
      { _id: payment._id, status: "pending" },
      { $set: { status: "success" } },
    );
    const confirmedPayment = await Payment.exists({
      _id: payment._id,
      status: "success",
    });
    if (!confirmedPayment) {
      throw new Error("Payment could not be marked successful.");
    }
    await User.updateOne(
      { _id: payment.user },
      { $set: { isPro: true } },
    );
    return;
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const updatedPayment = await Payment.findOneAndUpdate(
        { _id: payment._id, status: "pending" },
        { $set: { status: "success" } },
        { new: true, session },
      );
      if (!updatedPayment) {
        const existing = await Payment.findById(payment._id).session(session);
        if (existing?.status === "success") return;
        throw new Error("Payment could not be marked successful.");
      }
      if (updatedPayment.purpose === "wallet") {
        await User.updateOne(
          { _id: updatedPayment.user, walletBalanceMinor: { $exists: false } },
          { $set: { walletBalanceMinor: 0 } },
          { session },
        );
        await User.updateOne(
          { _id: updatedPayment.user },
          { $inc: { walletBalanceMinor: updatedPayment.amount } },
          { session },
        );
        await WalletTransaction.create(
          [
            {
              user: updatedPayment.user,
              reference: `payment:${updatedPayment.reference}`,
              kind: "topup",
              amountMinor: updatedPayment.amount,
              currency: updatedPayment.currency,
            },
          ],
          { session },
        );
      } else {
        await User.updateOne(
          { _id: updatedPayment.user },
          { $set: { isPro: true } },
          { session },
        );
      }
    });
  } finally {
    await session.endSession();
  }
}

function setSession(user, res) {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must be set to a random value of at least 32 characters.");
  }
  const token = jwt.sign({}, secret, {
    subject: user.id,
    expiresIn: "7d",
  });
  res.cookie(cookieName, token, authCookieOptions());
}

async function startSquadCheckout({ user, amount, currency, purpose, product }) {
  const reference = `sx_${crypto.randomUUID().replace(/-/g, "")}`;
  const payment = await Payment.create({
    user: user._id,
    reference,
    amount,
    currency,
    purpose,
  });
  const response = await fetch(
    `${getSquadApiBaseUrl()}/transaction/initiate`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SQUAD_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: user.email,
        amount,
        currency,
        initiate_type: "inline",
        transaction_ref: reference,
        callback_url: `${process.env.APP_URL || "http://localhost:3000"}/?payment=return`,
        metadata: { userId: String(user._id), product },
      }),
      signal: AbortSignal.timeout(10000),
    },
  );
  const payload = await response.json().catch(() => null);
  const checkoutUrl = payload?.data?.checkout_url || payload?.data?.url;
  if (!response.ok || !checkoutUrl || !/^https:\/\//i.test(checkoutUrl)) {
    await Payment.updateOne({ _id: payment._id }, { $set: { status: "failed" } });
    console.error("Squad checkout initiation failed:", response.status);
    const error = new Error("Unable to start checkout. Please try again.");
    error.status = 502;
    throw error;
  }
  return { checkoutUrl, reference };
}

authRouter.post("/signup", authRateLimit, async (req, res, next) => {
  try {
    const input = parseBody(signupSchema, req, res);
    if (!input) return;
    const username = input.username.toLowerCase();
    const email = input.email.toLowerCase();
    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await User.create({
      name: input.name,
      username,
      email,
      passwordHash,
    });
    setSession(user, res);
    return res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0];
      return res.status(409).json({
        error: field === "email" ? "That email is already registered." : "That username is taken.",
      });
    }
    return next(error);
  }
});

authRouter.post("/login", authRateLimit, async (req, res, next) => {
  try {
    const input = parseBody(loginSchema, req, res);
    if (!input) return;
    const user = await User.findOne({ email: input.email.toLowerCase() }).select(
      "+passwordHash",
    );
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      return res.status(401).json({ error: "Email or password is incorrect." });
    }
    setSession(user, res);
    return res.json({ user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

authRouter.post("/logout", (req, res) => {
  res.clearCookie(cookieName, {
    httpOnly: true,
    sameSite: "lax",
    secure:
      process.env.NODE_ENV === "production" ||
      process.env.COOKIE_SECURE === "true",
    path: "/",
  });
  return res.json({ ok: true });
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user, req.isAdmin) });
});

socialRouter.get("/feed", requireAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const pageSize = 20;
    const posts = await Post.find()
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .populate("author", "name username isPro")
      .lean();
    const ids = posts.map((post) => post._id);
    const [reactions, comments] = await Promise.all([
      Reaction.aggregate([
        { $match: { post: { $in: ids } } },
        { $group: { _id: "$post", count: { $sum: 1 } } },
      ]),
      Comment.aggregate([
        { $match: { post: { $in: ids } } },
        { $group: { _id: "$post", count: { $sum: 1 } } },
      ]),
    ]);
    const liked = await Reaction.find({
      user: req.user._id,
      post: { $in: ids },
    }).distinct("post");
    const reactionCounts = new Map(reactions.map((item) => [String(item._id), item.count]));
    const commentCounts = new Map(comments.map((item) => [String(item._id), item.count]));
    const likedIds = new Set(liked.map(String));
    return res.json({
      posts: posts.map((post) => ({
        id: post._id,
        body: post.body,
        createdAt: post.createdAt,
        author: publicUser(post.author),
        likeCount: reactionCounts.get(String(post._id)) || 0,
        commentCount: commentCounts.get(String(post._id)) || 0,
        liked: likedIds.has(String(post._id)),
      })),
      page,
    });
  } catch (error) {
    return next(error);
  }
});

socialRouter.post("/posts", requireAuth, writeRateLimit, async (req, res, next) => {
  try {
    const input = parseBody(
      z.object({ body: z.string().trim().min(1).max(1000) }),
      req,
      res,
    );
    if (!input) return;
    const post = await Post.create({ author: req.user._id, body: input.body });
    return res.status(201).json({
      post: {
        id: post._id,
        body: post.body,
        createdAt: post.createdAt,
        author: publicUser(req.user),
        likeCount: 0,
        commentCount: 0,
        liked: false,
      },
    });
  } catch (error) {
    return next(error);
  }
});

socialRouter.put("/posts/:postId/like", requireAuth, writeRateLimit, async (req, res, next) => {
  try {
    const input = parseBody(z.object({ liked: z.boolean() }), req, res);
    if (!input) return;
    if (!validId(req.params.postId)) {
      return res.status(400).json({ error: "Invalid post ID." });
    }
    if (!(await Post.exists({ _id: req.params.postId }))) {
      return res.status(404).json({ error: "Post not found." });
    }
    if (input.liked) {
      try {
        await Reaction.create({ post: req.params.postId, user: req.user._id });
      } catch (error) {
        if (error.code !== 11000) throw error;
      }
    } else {
      await Reaction.deleteOne({ post: req.params.postId, user: req.user._id });
    }
    const likeCount = await Reaction.countDocuments({ post: req.params.postId });
    return res.json({ liked: input.liked, likeCount });
  } catch (error) {
    return next(error);
  }
});

socialRouter.get("/posts/:postId/comments", requireAuth, async (req, res, next) => {
  try {
    if (!validId(req.params.postId)) {
      return res.status(400).json({ error: "Invalid post ID." });
    }
    if (!(await Post.exists({ _id: req.params.postId }))) {
      return res.status(404).json({ error: "Post not found." });
    }
    const comments = await Comment.find({ post: req.params.postId })
      .sort({ createdAt: 1 })
      .limit(50)
      .populate("author", "name username isPro")
      .lean();
    return res.json({
      comments: comments.map((comment) => ({
        id: comment._id,
        body: comment.body,
        createdAt: comment.createdAt,
        author: publicUser(comment.author),
      })),
    });
  } catch (error) {
    return next(error);
  }
});

socialRouter.post("/posts/:postId/comments", requireAuth, writeRateLimit, async (req, res, next) => {
  try {
    const input = parseBody(
      z.object({ body: z.string().trim().min(1).max(500) }),
      req,
      res,
    );
    if (!input) return;
    if (!validId(req.params.postId)) {
      return res.status(400).json({ error: "Invalid post ID." });
    }
    if (!(await Post.exists({ _id: req.params.postId }))) {
      return res.status(404).json({ error: "Post not found." });
    }
    const comment = await Comment.create({
      post: req.params.postId,
      author: req.user._id,
      body: input.body,
    });
    return res.status(201).json({
      comment: {
        id: comment._id,
        body: comment.body,
        createdAt: comment.createdAt,
        author: publicUser(req.user),
      },
    });
  } catch (error) {
    return next(error);
  }
});

socialRouter.put("/users/:userId/follow", requireAuth, writeRateLimit, async (req, res, next) => {
  try {
    const input = parseBody(z.object({ following: z.boolean() }), req, res);
    if (!input) return;
    if (!validId(req.params.userId)) {
      return res.status(400).json({ error: "Invalid user ID." });
    }
    if (String(req.user._id) === req.params.userId) {
      return res.status(400).json({ error: "You cannot follow yourself." });
    }
    if (!(await User.exists({ _id: req.params.userId }))) {
      return res.status(404).json({ error: "User not found." });
    }
    if (input.following) {
      try {
        await Follow.create({ follower: req.user._id, followed: req.params.userId });
      } catch (error) {
        if (error.code !== 11000) throw error;
      }
    } else {
      await Follow.deleteOne({ follower: req.user._id, followed: req.params.userId });
    }
    return res.json({ following: input.following });
  } catch (error) {
    return next(error);
  }
});

socialRouter.get("/dashboard", requireAuth, async (req, res, next) => {
  try {
    const [postCount, likesReceived, followerCount, followingCount, recentPosts] =
      await Promise.all([
        Post.countDocuments({ author: req.user._id }),
        Post.aggregate([
          { $match: { author: req.user._id } },
          { $lookup: { from: "reactions", localField: "_id", foreignField: "post", as: "reactions" } },
          { $project: { count: { $size: "$reactions" } } },
          { $group: { _id: null, total: { $sum: "$count" } } },
        ]),
        Follow.countDocuments({ followed: req.user._id }),
        Follow.countDocuments({ follower: req.user._id }),
        Post.find({ author: req.user._id }).sort({ createdAt: -1 }).limit(5).lean(),
      ]);
    return res.json({
      stats: {
        posts: postCount,
        likes: likesReceived[0]?.total || 0,
        followers: followerCount,
        following: followingCount,
      },
      recentPosts: recentPosts.map((post) => ({
        id: post._id,
        body: post.body,
        createdAt: post.createdAt,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

socialRouter.get("/discover", requireAuth, async (req, res, next) => {
  try {
    const following = await Follow.find({ follower: req.user._id }).distinct("followed");
    const users = await User.find({
      _id: { $ne: req.user._id, $nin: following },
    })
      .select("name username bio isPro")
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();
    return res.json({ users: users.map(publicUser) });
  } catch (error) {
    return next(error);
  }
});

billingRouter.get("/config", requireAuth, (req, res, next) => {
  try {
    const { amount, currency } = getProPlanConfig();
    const { minimum, maximum } = getWalletTopupLimits();
    return res.json({
      paymentsEnabled: Boolean(process.env.SQUAD_SECRET_KEY),
      amount,
      currency,
      walletMinimum: minimum,
      walletMaximum: maximum,
    });
  } catch (error) {
    return next(error);
  }
});

billingRouter.post("/webhook", async (req, res, next) => {
  try {
    const secret = process.env.SQUAD_SECRET_KEY;
    if (!secret) {
      return res.status(503).json({ error: "Payments are not configured yet." });
    }
    if (
      !isValidSquadSignature(
        req.get("x-squad-encrypted-body"),
        req.rawBody,
        secret,
      )
    ) {
      return res.status(401).json({ error: "Invalid Squad webhook signature." });
    }
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({ error: "Invalid Squad webhook payload." });
    }
    if (String(req.body.Event).toLowerCase() !== "charge_successful") {
      return res.json({ received: true });
    }
    const bodyReference = req.body.Body?.transaction_ref;
    const eventReference = req.body.TransactionRef;
    if (
      typeof bodyReference !== "string" &&
      typeof eventReference !== "string"
    ) {
      return res.status(400).json({ error: "Missing Squad transaction reference." });
    }
    if (
      bodyReference &&
      eventReference &&
      bodyReference !== eventReference
    ) {
      return res.status(400).json({ error: "Conflicting Squad transaction references." });
    }
    const reference = bodyReference || eventReference;
    if (!reference || reference.length > 100) {
      return res.status(400).json({ error: "Invalid Squad transaction reference." });
    }
    const payment = await Payment.findOne({ reference });
    if (!payment) return res.json({ received: true });

    const { response, payload } = await fetchSquadTransaction(reference);
    if (!response.ok) {
      console.error("Squad webhook transaction verification failed:", response.status);
      return res.status(502).json({ error: "Unable to verify payment right now." });
    }
    const transaction = payload?.data;
    if (
      !transaction ||
      String(transaction.transaction_status || transaction.status).toLowerCase() !==
        "success"
    ) {
      return res.status(502).json({ error: "Payment is not confirmed by Squad yet." });
    }
    if (!verifiedTransactionMatchesPayment(transaction, payment)) {
      console.error("Verified Squad payment details did not match the pending payment.");
      return res.json({ received: true });
    }
    await markPaymentSuccessful(payment);
    return res.json({ received: true });
  } catch (error) {
    return next(error);
  }
});

billingRouter.post("/checkout", requireAuth, writeRateLimit, async (req, res, next) => {
  try {
    if (!process.env.SQUAD_SECRET_KEY) {
      return res.status(503).json({ error: "Payments are not configured yet." });
    }
    const { amount, currency } = getProPlanConfig();
    if (req.user.isPro) {
      return res.status(409).json({ error: "Your account already has Pro access." });
    }
    const checkout = await startSquadCheckout({
      user: req.user,
      amount,
      currency,
      purpose: "pro",
      product: "socialx_pro",
    });
    return res.status(201).json(checkout);
  } catch (error) {
    if (error.status === 502) return res.status(502).json({ error: error.message });
    return next(error);
  }
});

billingRouter.post("/wallet/checkout", requireAuth, writeRateLimit, async (req, res, next) => {
  try {
    const input = parseBody(
      z.object({ amount: z.number().int().safe().positive() }),
      req,
      res,
    );
    if (!input) return;
    const { minimum, maximum } = getWalletTopupLimits();
    if (input.amount < minimum || input.amount > maximum) {
      return res.status(400).json({
        error: `Top-up amount must be between ${minimum} and ${maximum} minor units.`,
      });
    }
    if (!process.env.SQUAD_SECRET_KEY) {
      return res.status(503).json({ error: "Payments are not configured yet." });
    }
    const currency = engagementCurrency();
    const checkout = await startSquadCheckout({
      user: req.user,
      amount: input.amount,
      currency,
      purpose: "wallet",
      product: "socialx_wallet_topup",
    });
    return res.status(201).json(checkout);
  } catch (error) {
    if (error.status === 502) return res.status(502).json({ error: error.message });
    return next(error);
  }
});

billingRouter.get("/wallet", requireAuth, async (req, res, next) => {
  try {
    await User.updateOne(
      { _id: req.user._id, walletBalanceMinor: { $exists: false } },
      { $set: { walletBalanceMinor: 0 } },
    );
    const [user, transactions] = await Promise.all([
      User.findById(req.user._id).select("walletBalanceMinor").lean(),
      WalletTransaction.find({ user: req.user._id })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
    ]);
    const currency = engagementCurrency();
    return res.json({
      balanceMinor: user.walletBalanceMinor,
      currency,
      transactions: transactions.map((item) => ({
        id: item._id,
        kind: item.kind,
        amountMinor: item.amountMinor,
        currency: item.currency,
        createdAt: item.createdAt,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

billingRouter.post("/verify", requireAuth, writeRateLimit, async (req, res, next) => {
  try {
    const input = parseBody(
      z.object({ reference: z.string().min(1).max(100) }),
      req,
      res,
    );
    if (!input) return;
    const payment = await Payment.findOne({
      reference: input.reference,
      user: req.user._id,
    });
    if (!payment) return res.status(404).json({ error: "Payment not found." });
    if (payment.status === "success") {
      if (payment.purpose !== "wallet") {
        await User.updateOne(
          { _id: req.user._id },
          { $set: { isPro: true } },
        );
      }
      const user = payment.purpose === "wallet"
        ? await User.findById(req.user._id).select("walletBalanceMinor").lean()
        : null;
      return res.json({
        status: "success",
        purpose: payment.purpose,
        ...(user ? { balanceMinor: user.walletBalanceMinor } : {}),
      });
    }
    if (!process.env.SQUAD_SECRET_KEY) {
      return res.status(503).json({ error: "Payments are not configured yet." });
    }
    const { response, payload } = await fetchSquadTransaction(input.reference);
    if (!response.ok) {
      console.error("Squad payment verification failed:", response.status);
      return res.status(502).json({ error: "Unable to verify payment right now." });
    }
    if (!verifiedTransactionMatchesPayment(payload?.data, payment)) {
      return res.json({ status: payment.status === "failed" ? "failed" : "pending" });
    }
    await markPaymentSuccessful(payment);
    const user = payment.purpose === "wallet"
      ? await User.findById(req.user._id).select("walletBalanceMinor").lean()
      : null;
    return res.json({
      status: "success",
      purpose: payment.purpose,
      ...(user ? { balanceMinor: user.walletBalanceMinor } : {}),
    });
  } catch (error) {
    return next(error);
  }
});

function engagementCurrency() {
  const currency = (process.env.SQUAD_CURRENCY || "NGN").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error("SQUAD_CURRENCY must be a three-letter currency code.");
  }
  if (currency !== "NGN") {
    throw new Error("SQUAD_CURRENCY must be NGN while SMMH_USD_TO_NGN prices are enabled.");
  }
  return currency;
}

function publicEngagementOrder(order) {
  return {
    id: order._id,
    providerOrderId: order.providerOrderId,
    serviceId: order.serviceId,
    serviceName: order.serviceName,
    link: order.link,
    quantity: order.quantity,
    runs: order.runs,
    interval: order.interval,
    chargeMinor: order.chargeMinor,
    refundedMinor: order.refundedMinor,
    currency: order.currency,
    startCount: order.startCount,
    remains: order.remains,
    status: order.status,
    providerStatus: order.providerStatus,
    refillAvailable: order.refillAvailable,
    refillId: order.refillId,
    refillStatus: order.refillStatus,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

function publicSupportTicket(ticket) {
  return {
    id: ticket._id,
    subject: ticket.subject,
    category: ticket.category,
    status: ticket.status,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    messages: ticket.messages.map((message) => ({
      id: message._id,
      authorName: message.authorName,
      isAdmin: message.isAdmin,
      body: message.body,
      createdAt: message.createdAt,
    })),
  };
}

function normalizedOrderStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "completed" || value === "complete") return "completed";
  if (value === "partial") return "partial";
  if (value === "canceled" || value === "cancelled") return "canceled";
  if (value === "failed" || value === "error") return "failed";
  if (value === "in progress" || value === "processing") return "in_progress";
  return "pending";
}

function safeOptionalCount(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

async function reconcileEngagementOrder(orderId, statusResult) {
  const providerStatus = String(statusResult?.status || "");
  const status = normalizedOrderStatus(providerStatus);
  const providerCharge =
    statusResult?.charge === undefined || statusResult?.charge === null
      ? null
      : String(statusResult.charge);
  let actualChargeMinor = null;
  if ((status === "partial" || status === "failed") && providerCharge !== null) {
    try {
      actualChargeMinor = calculatePriceMinorFromUsd(
        providerCharge,
        getEngagementPricingConfig(),
      );
    } catch (error) {
      console.error("Could not calculate order refund:", error.message);
    }
  }

  const session = await mongoose.startSession();
  let updatedOrder;
  try {
    await session.withTransaction(async () => {
      updatedOrder = await EngagementOrder.findById(orderId).session(session);
      if (!updatedOrder) return;
      let refundTarget = null;
      if (status === "canceled" || (status === "failed" && actualChargeMinor === 0)) {
        refundTarget = updatedOrder.chargeMinor;
      } else if (status === "partial" && actualChargeMinor !== null) {
        refundTarget = Math.max(0, updatedOrder.chargeMinor - actualChargeMinor);
      }
      if (refundTarget !== null) {
        refundTarget = Math.min(
          updatedOrder.chargeMinor,
          Math.max(updatedOrder.refundedMinor, refundTarget),
        );
        const refundDelta = refundTarget - updatedOrder.refundedMinor;
        if (refundDelta > 0) {
          await User.updateOne(
            { _id: updatedOrder.user, walletBalanceMinor: { $exists: false } },
            { $set: { walletBalanceMinor: 0 } },
            { session },
          );
          await User.updateOne(
            { _id: updatedOrder.user },
            { $inc: { walletBalanceMinor: refundDelta } },
            { session },
          );
          await WalletTransaction.create(
            [
              {
                user: updatedOrder.user,
                reference: `order-refund:${updatedOrder._id}:${refundTarget}`,
                kind: "order_refund",
                amountMinor: refundDelta,
                currency: updatedOrder.currency,
                order: updatedOrder._id,
              },
            ],
            { session },
          );
          updatedOrder.refundedMinor = refundTarget;
        }
      }
      updatedOrder.providerStatus = providerStatus || updatedOrder.providerStatus;
      updatedOrder.status = status;
      updatedOrder.providerCharge = providerCharge ?? updatedOrder.providerCharge;
      updatedOrder.providerCurrency =
        statusResult?.currency || updatedOrder.providerCurrency;
      updatedOrder.startCount =
        safeOptionalCount(statusResult?.start_count) ?? updatedOrder.startCount;
      updatedOrder.remains =
        safeOptionalCount(statusResult?.remains) ?? updatedOrder.remains;
      await updatedOrder.save({ session });
    });
  } finally {
    await session.endSession();
  }
  return updatedOrder;
}

async function fetchEngagementStatus(order) {
  const results = await requestProvider("status", { order: order.providerOrderId });
  const result = Array.isArray(results)
    ? results.find((item) => String(item.order) === order.providerOrderId)
    : results;
  if (!result || result.error) {
    throw new SmmProviderError("Could not retrieve the provider order status.", 502);
  }
  return reconcileEngagementOrder(order._id, result);
}

function reportSmmProviderError(error, res, next) {
  if (error.code === "SMMH_NOT_CONFIGURED") {
    return res.status(503).json({ error: "SMM Resellers Hub is not configured yet." });
  }
  if (error.code === "SMMH_CONFIG_INVALID") {
    return res.status(503).json({ error: "SMM Resellers Hub API URL is misconfigured." });
  }
  if (error.code === "SMMH_PRICING_NOT_CONFIGURED") {
    return res.status(503).json({ error: "Service pricing is not configured yet." });
  }
  if (error instanceof SmmProviderError) {
    console.error("SMM provider request failed:", error.status);
    return res.status(error.status === 429 ? 503 : 502).json({
      error: "The service provider is temporarily unavailable. Please try again.",
    });
  }
  return next(error);
}

engagementRouter.get("/services", requireAuth, async (req, res, next) => {
  try {
    const services = await requestProvider("services");
    if (!Array.isArray(services)) {
      throw new SmmProviderError("Unexpected services response.", 502);
    }
    let pricingConfig = null;
    try {
      pricingConfig = getEngagementPricingConfig();
    } catch (error) {
      if (error.code !== "SMMH_PRICING_NOT_CONFIGURED") throw error;
    }
    return res.json({
      currency: engagementCurrency(),
      pricingEnabled: Boolean(pricingConfig),
      services: services.map((service) => {
        const rate = String(service.rate);
        return {
          id: String(service.service),
          name: String(service.name || `Service ${service.service}`),
          category: String(service.category || ""),
          rate,
          min: safeOptionalCount(service.min),
          max: safeOptionalCount(service.max),
          refill: Boolean(service.refill),
          dripfeed: Boolean(service.dripfeed),
          pricePerThousandMinor: pricingConfig
            ? calculatePriceMinor(rate, 1000, pricingConfig)
            : null,
        };
      }),
    });
  } catch (error) {
    return reportSmmProviderError(error, res, next);
  }
});

engagementRouter.get("/orders", requireAuth, async (req, res, next) => {
  try {
    const activeStatuses = ["submitting", "submission_unknown", "pending", "in_progress"];
    const [orders, [summary = {}]] = await Promise.all([
      EngagementOrder.find({ user: req.user._id })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
      EngagementOrder.aggregate([
        { $match: { user: req.user._id } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            active: {
              $sum: { $cond: [{ $in: ["$status", activeStatuses] }, 1, 0] },
            },
            completed: {
              $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
            },
            chargeMinor: { $sum: "$chargeMinor" },
            refundedMinor: { $sum: "$refundedMinor" },
          },
        },
      ]),
    ]);
    return res.json({
      orders: orders.map(publicEngagementOrder),
      summary: {
        total: summary.total || 0,
        active: summary.active || 0,
        completed: summary.completed || 0,
        spendMinor: Math.max(0, (summary.chargeMinor || 0) - (summary.refundedMinor || 0)),
      },
    });
  } catch (error) {
    return next(error);
  }
});

engagementRouter.post("/orders", requireAuth, writeRateLimit, async (req, res, next) => {
  try {
    const input = parseBody(
      z.object({
        serviceId: z.string().trim().min(1).max(40),
        link: z.string().trim().url().max(2048),
        quantity: z.number().int().safe().positive(),
        runs: z.number().int().safe().positive().optional(),
        interval: z.number().int().safe().positive().optional(),
      }),
      req,
      res,
    );
    if (!input) return;
    const target = new URL(input.link);
    if (target.protocol !== "https:" || target.username || target.password) {
      return res.status(400).json({ error: "Target link must be a public HTTPS URL." });
    }
    const services = await requestProvider("services");
    const service = Array.isArray(services)
      ? services.find((item) => String(item.service) === input.serviceId)
      : null;
    if (!service) return res.status(400).json({ error: "That service is unavailable." });
    const min = Number(service.min);
    const max = Number(service.max);
    if (
      !Number.isSafeInteger(min) ||
      !Number.isSafeInteger(max) ||
      input.quantity < min ||
      input.quantity > max
    ) {
      return res.status(400).json({
        error: `Quantity must be between ${service.min} and ${service.max}.`,
      });
    }
    if (service.dripfeed && (input.runs !== undefined || input.interval !== undefined)) {
      if (input.runs === undefined || input.interval === undefined) {
        return res.status(400).json({ error: "Provide both runs and interval for drip-feed." });
      }
      if (input.runs > 1000 || input.interval > 100000) {
        return res.status(400).json({ error: "Drip-feed settings are outside allowed limits." });
      }
    } else if (input.runs !== undefined || input.interval !== undefined) {
      return res.status(400).json({ error: "This service does not support drip-feed settings." });
    }
    const pricingConfig = getEngagementPricingConfig();
    const chargeMinor = calculatePriceMinor(
      service.rate,
      input.quantity,
      pricingConfig,
    );
    const session = await mongoose.startSession();
    let order;
    try {
      await session.withTransaction(async () => {
        await User.updateOne(
          { _id: req.user._id, walletBalanceMinor: { $exists: false } },
          { $set: { walletBalanceMinor: 0 } },
          { session },
        );
        const debitedUser = await User.findOneAndUpdate(
          { _id: req.user._id, walletBalanceMinor: { $gte: chargeMinor } },
          { $inc: { walletBalanceMinor: -chargeMinor } },
          { new: true, session },
        );
        if (!debitedUser) {
          const error = new Error("Your wallet balance is too low for this order.");
          error.code = "INSUFFICIENT_WALLET";
          throw error;
        }
        const [createdOrder] = await EngagementOrder.create(
          [
            {
              user: req.user._id,
              serviceId: input.serviceId,
              serviceName: String(service.name || `Service ${service.service}`),
              link: target.toString(),
              quantity: input.quantity,
              runs: input.runs,
              interval: input.interval,
              chargeMinor,
              currency: engagementCurrency(),
              refillAvailable: Boolean(service.refill),
              status: "submitting",
            },
          ],
          { session },
        );
        await WalletTransaction.create(
          [
            {
              user: req.user._id,
              reference: `order-debit:${createdOrder._id}`,
              kind: "order_debit",
              amountMinor: -chargeMinor,
              currency: createdOrder.currency,
              order: createdOrder._id,
            },
          ],
          { session },
        );
        order = createdOrder;
      });
    } finally {
      await session.endSession();
    }
    let providerOrder;
    try {
      providerOrder = await requestProvider("add", {
        service: input.serviceId,
        link: target.toString(),
        quantity: input.quantity,
        runs: input.runs,
        interval: input.interval,
      });
    } catch (error) {
      if (error instanceof SmmProviderError && (error.status === 200 || (error.status >= 400 && error.status < 500))) {
        const refundSession = await mongoose.startSession();
        try {
          await refundSession.withTransaction(async () => {
            await User.updateOne(
              { _id: req.user._id, walletBalanceMinor: { $exists: false } },
              { $set: { walletBalanceMinor: 0 } },
              { session: refundSession },
            );
            await User.updateOne(
              { _id: req.user._id },
              { $inc: { walletBalanceMinor: chargeMinor } },
              { session: refundSession },
            );
            await WalletTransaction.create(
              [
                {
                  user: req.user._id,
                  reference: `order-refund:${order._id}:${chargeMinor}`,
                  kind: "order_refund",
                  amountMinor: chargeMinor,
                  currency: order.currency,
                  order: order._id,
                },
              ],
              { session: refundSession },
            );
            await EngagementOrder.updateOne(
              { _id: order._id },
              {
                $set: {
                  status: "failed",
                  providerStatus: "Rejected by provider",
                  refundedMinor: chargeMinor,
                },
              },
              { session: refundSession },
            );
          });
        } finally {
          await refundSession.endSession();
        }
        return res.status(502).json({
          error: "The provider rejected the order; the wallet charge was refunded.",
        });
      }
      await EngagementOrder.updateOne(
        { _id: order._id },
        { $set: { status: "submission_unknown", providerStatus: "Submission outcome unknown" } },
      );
      console.error("SMM order submission outcome is unknown:", error.message);
      return res.status(502).json({
        error: "We could not confirm the provider received this order. Check your order history before trying again.",
      });
    }
    const providerOrderId = providerOrder?.order;
    if (
      providerOrderId === undefined ||
      providerOrderId === null ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(String(providerOrderId))
    ) {
      await EngagementOrder.updateOne(
        { _id: order._id },
        { $set: { status: "submission_unknown", providerStatus: "Invalid provider response" } },
      );
      return res.status(502).json({
        error: "We could not confirm the provider received this order. Contact support before retrying.",
      });
    }
    order = await EngagementOrder.findByIdAndUpdate(
      order._id,
      {
        $set: {
          providerOrderId: String(providerOrderId),
          status: "pending",
          providerStatus: "Pending",
        },
      },
      { new: true },
    );
    return res.status(201).json({ order: publicEngagementOrder(order) });
  } catch (error) {
    if (error.code === "INSUFFICIENT_WALLET") {
      return res.status(409).json({ error: error.message });
    }
    return reportSmmProviderError(error, res, next);
  }
});

engagementRouter.get("/orders/:orderId", requireAuth, async (req, res, next) => {
  try {
    if (!validId(req.params.orderId)) {
      return res.status(400).json({ error: "Invalid order ID." });
    }
    const order = await EngagementOrder.findOne({
      _id: req.params.orderId,
      user: req.user._id,
    });
    if (!order) return res.status(404).json({ error: "Order not found." });
    if (!order.providerOrderId) {
      return res.json({ order: publicEngagementOrder(order) });
    }
    const updated = await fetchEngagementStatus(order);
    return res.json({ order: publicEngagementOrder(updated) });
  } catch (error) {
    return reportSmmProviderError(error, res, next);
  }
});

engagementRouter.post("/orders/:orderId/cancel", requireAuth, writeRateLimit, async (req, res, next) => {
  try {
    if (!validId(req.params.orderId)) {
      return res.status(400).json({ error: "Invalid order ID." });
    }
    const order = await EngagementOrder.findOne({
      _id: req.params.orderId,
      user: req.user._id,
    });
    if (!order) return res.status(404).json({ error: "Order not found." });
    if (!order.providerOrderId || !["pending", "in_progress"].includes(order.status)) {
      return res.status(409).json({ error: "This order can no longer be canceled." });
    }
    const result = await requestProvider("cancel", { orders: order.providerOrderId });
    const cancelResult = Array.isArray(result)
      ? result.find((item) => String(item.order) === order.providerOrderId) || result[0]
      : result;
    if (cancelResult?.cancel?.error || cancelResult?.error) {
      return res.status(409).json({ error: "The provider could not cancel this order." });
    }
    const updated = await fetchEngagementStatus(order);
    return res.json({ order: publicEngagementOrder(updated) });
  } catch (error) {
    return reportSmmProviderError(error, res, next);
  }
});

engagementRouter.post("/orders/:orderId/refill", requireAuth, writeRateLimit, async (req, res, next) => {
  try {
    if (!validId(req.params.orderId)) {
      return res.status(400).json({ error: "Invalid order ID." });
    }
    const order = await EngagementOrder.findOne({
      _id: req.params.orderId,
      user: req.user._id,
    });
    if (!order) return res.status(404).json({ error: "Order not found." });
    if (!order.refillAvailable || order.status !== "completed" || order.refillId) {
      return res.status(409).json({ error: "This order is not eligible for a refill." });
    }
    const result = await requestProvider("refill", { order: order.providerOrderId });
    const refillResult = Array.isArray(result)
      ? result.find((item) => String(item.order) === order.providerOrderId) || result[0]
      : result;
    if (!refillResult?.refill || refillResult?.error) {
      throw new SmmProviderError("Provider did not return a refill ID.", 502);
    }
    order.refillId = String(refillResult.refill);
    order.refillStatus = "Pending";
    await order.save();
    return res.status(201).json({ order: publicEngagementOrder(order) });
  } catch (error) {
    return reportSmmProviderError(error, res, next);
  }
});

engagementRouter.get("/orders/:orderId/refill", requireAuth, async (req, res, next) => {
  try {
    if (!validId(req.params.orderId)) {
      return res.status(400).json({ error: "Invalid order ID." });
    }
    const order = await EngagementOrder.findOne({
      _id: req.params.orderId,
      user: req.user._id,
    });
    if (!order) return res.status(404).json({ error: "Order not found." });
    if (!order.refillId) return res.status(404).json({ error: "No refill was requested." });
    const result = await requestProvider("refill_status", { refill: order.refillId });
    const refillResult = Array.isArray(result)
      ? result.find((item) => String(item.refill) === order.refillId) || result[0]
      : result;
    if (refillResult?.error) {
      return res.status(502).json({ error: "Could not retrieve the refill status." });
    }
    order.refillStatus = String(
      refillResult?.status || refillResult?.refill_status || "Pending",
    );
    await order.save();
    return res.json({ order: publicEngagementOrder(order) });
  } catch (error) {
    return reportSmmProviderError(error, res, next);
  }
});

supportRouter.use(requireAuth);

supportRouter.get("/tickets", async (req, res, next) => {
  try {
    const tickets = await SupportTicket.find({ user: req.user._id })
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean();
    return res.json({ tickets: tickets.map(publicSupportTicket) });
  } catch (error) {
    return next(error);
  }
});

supportRouter.post("/tickets", writeRateLimit, async (req, res, next) => {
  try {
    const input = parseBody(
      z.object({
        subject: z.string().trim().min(3).max(120),
        category: z.enum(["payments", "orders", "account", "technical", "other"]),
        message: z.string().trim().min(5).max(4000),
      }),
      req,
      res,
    );
    if (!input) return;
    const ticket = await SupportTicket.create({
      user: req.user._id,
      subject: input.subject,
      category: input.category,
      messages: [
        {
          author: req.user._id,
          authorName: req.user.name,
          isAdmin: req.isAdmin,
          body: input.message,
        },
      ],
    });
    return res.status(201).json({ ticket: publicSupportTicket(ticket) });
  } catch (error) {
    return next(error);
  }
});

supportRouter.post("/tickets/:ticketId/messages", writeRateLimit, async (req, res, next) => {
  try {
    if (!validId(req.params.ticketId)) {
      return res.status(400).json({ error: "Invalid support ticket ID." });
    }
    const input = parseBody(
      z.object({ message: z.string().trim().min(1).max(4000) }),
      req,
      res,
    );
    if (!input) return;
    const ticket = await SupportTicket.findOne({
      _id: req.params.ticketId,
      user: req.user._id,
    });
    if (!ticket) return res.status(404).json({ error: "Support ticket not found." });
    if (ticket.messages.length >= 100) {
      return res.status(409).json({ error: "This ticket has reached its reply limit. Please open a new ticket." });
    }
    ticket.messages.push({
      author: req.user._id,
      authorName: req.user.name,
      isAdmin: req.isAdmin,
      body: input.message,
    });
    ticket.status = "open";
    await ticket.save();
    return res.json({ ticket: publicSupportTicket(ticket) });
  } catch (error) {
    return next(error);
  }
});

adminRouter.use(requireAuth, requireAdmin);

adminRouter.get("/overview", async (req, res, next) => {
  try {
    const activeStatuses = ["submitting", "submission_unknown", "pending", "in_progress"];
    const [totalUsers, totalOrders, activeOrders, completedOrders, openTickets, totalTickets, statuses, services, recentOrders] =
      await Promise.all([
        User.countDocuments(),
        EngagementOrder.countDocuments(),
        EngagementOrder.countDocuments({ status: { $in: activeStatuses } }),
        EngagementOrder.countDocuments({ status: "completed" }),
        SupportTicket.countDocuments({ status: { $in: ["open", "in_progress"] } }),
        SupportTicket.countDocuments(),
        EngagementOrder.aggregate([
          { $group: { _id: "$status", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        EngagementOrder.aggregate([
          { $group: { _id: "$serviceName", count: { $sum: 1 } } },
          { $sort: { count: -1, _id: 1 } },
          { $limit: 5 },
        ]),
        EngagementOrder.find()
          .populate("user", "name username email")
          .sort({ createdAt: -1 })
          .limit(5)
          .lean(),
      ]);
    return res.json({
      totalUsers,
      totalOrders,
      activeOrders,
      completedOrders,
      openTickets,
      totalTickets,
      statuses: statuses.map(({ _id, count }) => ({ status: _id, count })),
      topServices: services.map(({ _id, count }) => ({ serviceName: _id, count })),
      recentOrders: recentOrders.map((order) => ({
        ...publicEngagementOrder(order),
        user: order.user
          ? {
              id: order.user._id,
              name: order.user.name,
              username: order.user.username,
              email: order.user.email,
            }
          : null,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

adminRouter.get("/tickets", async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const pageSize = 50;
    const filter = {};
    if (typeof req.query.status === "string" && req.query.status !== "all") {
      if (!["open", "in_progress", "resolved"].includes(req.query.status)) {
        return res.status(400).json({ error: "Invalid support ticket status." });
      }
      filter.status = req.query.status;
    }
    const [tickets, total] = await Promise.all([
      SupportTicket.find(filter)
        .populate("user", "name username email")
        .sort({ updatedAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      SupportTicket.countDocuments(filter),
    ]);
    return res.json({
      tickets: tickets.map((ticket) => ({
        ...publicSupportTicket(ticket),
        user: ticket.user
          ? {
              id: ticket.user._id,
              name: ticket.user.name,
              username: ticket.user.username,
              email: ticket.user.email,
            }
          : null,
      })),
      page,
      total,
    });
  } catch (error) {
    return next(error);
  }
});

adminRouter.post("/tickets/:ticketId/messages", writeRateLimit, async (req, res, next) => {
  try {
    if (!validId(req.params.ticketId)) {
      return res.status(400).json({ error: "Invalid support ticket ID." });
    }
    const input = parseBody(
      z.object({ message: z.string().trim().min(1).max(4000) }),
      req,
      res,
    );
    if (!input) return;
    const ticket = await SupportTicket.findById(req.params.ticketId);
    if (!ticket) return res.status(404).json({ error: "Support ticket not found." });
    if (ticket.messages.length >= 100) {
      return res.status(409).json({ error: "This ticket has reached its reply limit." });
    }
    ticket.messages.push({
      author: req.user._id,
      authorName: req.user.name,
      isAdmin: true,
      body: input.message,
    });
    ticket.status = "in_progress";
    await ticket.save();
    return res.json({ ticket: publicSupportTicket(ticket) });
  } catch (error) {
    return next(error);
  }
});

adminRouter.patch("/tickets/:ticketId/status", writeRateLimit, async (req, res, next) => {
  try {
    if (!validId(req.params.ticketId)) {
      return res.status(400).json({ error: "Invalid support ticket ID." });
    }
    const input = parseBody(
      z.object({ status: z.enum(["open", "in_progress", "resolved"]) }),
      req,
      res,
    );
    if (!input) return;
    const ticket = await SupportTicket.findByIdAndUpdate(
      req.params.ticketId,
      { $set: { status: input.status } },
      { new: true, runValidators: true },
    );
    if (!ticket) return res.status(404).json({ error: "Support ticket not found." });
    return res.json({ ticket: publicSupportTicket(ticket) });
  } catch (error) {
    return next(error);
  }
});

adminRouter.get("/provider-balance", async (req, res, next) => {
  try {
    const balance = await requestProvider("balance");
    const amount = Number(balance?.balance);
    const currency = String(balance?.currency || "").toUpperCase();
    if (!Number.isFinite(amount) || !/^[A-Z]{3}$/.test(currency)) {
      throw new SmmProviderError("Unexpected provider balance response.", 502);
    }
    return res.json({ balance: amount, currency });
  } catch (error) {
    return reportSmmProviderError(error, res, next);
  }
});

adminRouter.post("/orders/:orderId/refresh", async (req, res, next) => {
  try {
    if (!validId(req.params.orderId)) {
      return res.status(400).json({ error: "Invalid order ID." });
    }
    const order = await EngagementOrder.findById(req.params.orderId);
    if (!order) return res.status(404).json({ error: "Order not found." });
    if (!order.providerOrderId) {
      return res.status(409).json({ error: "The provider has not assigned an order ID yet." });
    }
    const updated = await fetchEngagementStatus(order);
    return res.json({ order: publicEngagementOrder(updated) });
  } catch (error) {
    return reportSmmProviderError(error, res, next);
  }
});

adminRouter.get("/users", async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const pageSize = 50;
    const [users, total] = await Promise.all([
      User.find()
        .select("name username email isPro walletBalanceMinor createdAt")
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      User.countDocuments(),
    ]);
    return res.json({
      users: users.map((user) => ({ id: user._id, ...user })),
      page,
      total,
    });
  } catch (error) {
    return next(error);
  }
});

adminRouter.get("/orders", async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const pageSize = 50;
    const filter = {};
    if (typeof req.query.status === "string" && req.query.status) {
      filter.status = req.query.status;
    }
    const [orders, total] = await Promise.all([
      EngagementOrder.find(filter)
        .populate("user", "name username email")
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      EngagementOrder.countDocuments(filter),
    ]);
    return res.json({
      orders: orders.map((order) => ({
        ...publicEngagementOrder(order),
        user: order.user
          ? {
              id: order.user._id,
              name: order.user.name,
              username: order.user.username,
              email: order.user.email,
            }
          : null,
      })),
      page,
      total,
    });
  } catch (error) {
    return next(error);
  }
});

apiRouter.get("/health", (req, res) => {
  res.json({ ok: true });
});
apiRouter.use("/auth", authRouter);
apiRouter.use("/", socialRouter);
apiRouter.use("/billing", billingRouter);
apiRouter.use("/engagement", engagementRouter);
apiRouter.use("/support", supportRouter);
apiRouter.use("/admin", adminRouter);

module.exports = { apiRouter };
