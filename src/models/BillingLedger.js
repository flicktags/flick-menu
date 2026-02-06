// ===============================
// ✅ 2) MODEL: BillingLedger (Wallet Ledger)
// File: src/models/BillingLedger.js
// ===============================
import mongoose from "mongoose";

const PaymentSchema = new mongoose.Schema(
  {
    // Gateway-agnostic
    provider: { type: String, default: "" }, // "mpgs" | "tap" | "stripe" | "benefit" | etc.
    status: { type: String, default: "" }, // "succeeded"|"failed"|"pending"|"reversed"
    transactionId: { type: String, default: "" },
    merchantReference: { type: String, default: "" }, // your ref shown in admin
    authCode: { type: String, default: "" },
    resultCode: { type: String, default: "" },
    paidAt: { type: Date, default: null },

    // Optional: keep minimal gateway payload (safe subset)
    raw: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

const BillingLedgerSchema = new mongoose.Schema(
  {
    // Identity
    ledgerId: { type: String, required: true, unique: true, index: true }, // e.g. LED-20260204-000001
    branchId: { type: String, required: true, index: true },
    vendorId: { type: String, required: true, index: true },

    // Actor / audit
    actorUserId: { type: String, default: "" }, // who triggered it (admin/vendor/system)
    actorRole: { type: String, default: "" }, // "vendor"|"branch"|"system"|"admin"
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },

    // Entry type
    entryType: {
      type: String,
      enum: ["TOPUP", "ORDER_DEBIT", "ADJUSTMENT", "REVERSAL"],
      required: true,
      index: true,
    },

    // Financial semantics
    direction: { type: String, enum: ["CREDIT", "DEBIT"], required: true },
    amountFils: { type: Number, required: true }, // + for credit, + for debit (direction tells meaning)
    currency: { type: String, default: "BHD" },

    // Orders semantics (wallet is orders-based)
    unitFeeFils: { type: Number, default: 0 }, // the per-order fee in fils at time of entry (for audit)
    ordersPurchased: { type: Number, default: 0 }, // topup
    bonusOrdersGranted: { type: Number, default: 0 }, // topup
    ordersDebited: { type: Number, default: 0 }, // order debit (usually 1)

    // Link to business objects
    orderId: { type: String, default: "", index: true },
    orderNumber: { type: String, default: "" },

    // Status (topups later will start pending when gateway integrated)
    status: {
      type: String,
      enum: ["pending", "succeeded", "failed", "reversed"],
      default: "succeeded",
      index: true,
    },

    // Idempotency (critical: prevents double-credit/double-debit)
    // idempotencyKey: { type: String, default: "", unique: true, sparse: true },
    idempotencyKey: { type: String, default: null },

    // Payment info (empty for manual topups now)
    payment: { type: PaymentSchema, default: () => ({}) },

    // Snapshot after entry (for audit + faster UI)
    snapshotAfter: {
      paidOrdersRemaining: { type: Number, default: 0 },
      bonusOrdersRemaining: { type: Number, default: 0 },
      totalOrdersRemaining: { type: Number, default: 0 },
    },

    // Human-readable
    title: { type: String, default: "" },
    note: { type: String, default: "" },

    // Extra metadata
    meta: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);

BillingLedgerSchema.index({ branchId: 1, createdAt: -1 });
BillingLedgerSchema.index(
  { idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      idempotencyKey: { $exists: true, $type: "string", $ne: "" },
    },
  },
);


BillingLedgerSchema.index({ vendorId: 1, createdAt: -1 });
BillingLedgerSchema.index({ entryType: 1, createdAt: -1 });


export default mongoose.model("BillingLedger", BillingLedgerSchema);
