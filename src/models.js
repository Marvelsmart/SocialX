const mongoose = require("mongoose");

const { Schema } = mongoose;

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    username: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      minlength: 3,
      maxlength: 24,
      match: /^[a-z0-9_]+$/,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
    },
    passwordHash: { type: String, required: true, select: false },
    bio: { type: String, trim: true, maxlength: 160, default: "" },
    isAdmin: { type: Boolean, default: false },
    isPro: { type: Boolean, default: false },
    walletBalanceMinor: { type: Number, min: 0, default: 0 },
  },
  { timestamps: true },
);
userSchema.index({ username: 1 }, { unique: true });
userSchema.index({ email: 1 }, { unique: true });

const postSchema = new Schema(
  {
    author: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    body: { type: String, required: true, trim: true, maxlength: 1000 },
  },
  { timestamps: true },
);
postSchema.index({ createdAt: -1 });
postSchema.index({ author: 1, createdAt: -1 });

const reactionSchema = new Schema(
  {
    post: { type: Schema.Types.ObjectId, ref: "Post", required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);
reactionSchema.index({ post: 1, user: 1 }, { unique: true });
reactionSchema.index({ user: 1, createdAt: -1 });

const commentSchema = new Schema(
  {
    post: { type: Schema.Types.ObjectId, ref: "Post", required: true },
    author: { type: Schema.Types.ObjectId, ref: "User", required: true },
    body: { type: String, required: true, trim: true, maxlength: 500 },
  },
  { timestamps: true },
);
commentSchema.index({ post: 1, createdAt: 1 });
commentSchema.index({ author: 1, createdAt: -1 });

const followSchema = new Schema(
  {
    follower: { type: Schema.Types.ObjectId, ref: "User", required: true },
    followed: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);
followSchema.index({ follower: 1, followed: 1 }, { unique: true });
followSchema.index({ followed: 1, createdAt: -1 });

const paymentSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    reference: { type: String, required: true, unique: true },
    amount: { type: Number, required: true, min: 1 },
    currency: { type: String, required: true, default: "NGN" },
    purpose: {
      type: String,
      enum: ["pro", "wallet"],
      default: "pro",
    },
    status: {
      type: String,
      enum: ["pending", "success", "failed"],
      default: "pending",
    },
  },
  { timestamps: true },
);
paymentSchema.index({ user: 1, createdAt: -1 });

const walletTransactionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    reference: { type: String, required: true, unique: true },
    kind: {
      type: String,
      enum: ["topup", "order_debit", "order_refund"],
      required: true,
    },
    amountMinor: { type: Number, required: true },
    currency: { type: String, required: true, default: "NGN" },
    order: { type: Schema.Types.ObjectId, ref: "EngagementOrder" },
  },
  { timestamps: true },
);
walletTransactionSchema.index({ user: 1, createdAt: -1 });

const engagementOrderSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    providerOrderId: { type: String, default: null },
    serviceId: { type: String, required: true },
    serviceName: { type: String, required: true },
    link: { type: String, required: true, maxlength: 2048 },
    quantity: { type: Number, required: true, min: 1 },
    runs: { type: Number, min: 1 },
    interval: { type: Number, min: 1 },
    chargeMinor: { type: Number, required: true, min: 1 },
    refundedMinor: { type: Number, default: 0, min: 0 },
    currency: { type: String, required: true, default: "NGN" },
    providerCharge: { type: String, default: null },
    providerCurrency: { type: String, default: "USD" },
    startCount: { type: Number, default: null },
    remains: { type: Number, default: null },
    providerStatus: { type: String, default: null },
    status: {
      type: String,
      enum: [
        "submitting",
        "submission_unknown",
        "pending",
        "in_progress",
        "completed",
        "partial",
        "canceled",
        "failed",
      ],
      default: "submitting",
    },
    refillAvailable: { type: Boolean, default: false },
    refillId: { type: String, default: null },
    refillStatus: { type: String, default: null },
  },
  { timestamps: true },
);
engagementOrderSchema.index({ user: 1, createdAt: -1 });
engagementOrderSchema.index(
  { providerOrderId: 1 },
  { unique: true, partialFilterExpression: { providerOrderId: { $type: "string" } } },
);

const supportMessageSchema = new Schema(
  {
    author: { type: Schema.Types.ObjectId, ref: "User", required: true },
    authorName: { type: String, required: true, trim: true, maxlength: 60 },
    isAdmin: { type: Boolean, default: false },
    body: { type: String, required: true, trim: true, maxlength: 4000 },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const supportTicketSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    subject: { type: String, required: true, trim: true, maxlength: 120 },
    category: {
      type: String,
      enum: ["payments", "orders", "account", "technical", "other"],
      required: true,
    },
    status: {
      type: String,
      enum: ["open", "in_progress", "resolved"],
      default: "open",
    },
    messages: { type: [supportMessageSchema], default: [] },
  },
  { timestamps: true },
);
supportTicketSchema.index({ user: 1, updatedAt: -1 });
supportTicketSchema.index({ status: 1, updatedAt: -1 });

module.exports = {
  User: mongoose.model("User", userSchema),
  Post: mongoose.model("Post", postSchema),
  Reaction: mongoose.model("Reaction", reactionSchema),
  Comment: mongoose.model("Comment", commentSchema),
  Follow: mongoose.model("Follow", followSchema),
  Payment: mongoose.model("Payment", paymentSchema),
  WalletTransaction: mongoose.model("WalletTransaction", walletTransactionSchema),
  EngagementOrder: mongoose.model("EngagementOrder", engagementOrderSchema),
  SupportTicket: mongoose.model("SupportTicket", supportTicketSchema),
};
