// ===============================
// ✅ 1) MODEL: BranchWalletAccount
// File: src/models/BranchWalletAccount.js
// ===============================
import mongoose from "mongoose";

const BranchWalletAccountSchema = new mongoose.Schema(
  {
    // Identity
    branchId: { type: String, required: true, unique: true, index: true },
    vendorId: { type: String, required: true, index: true },

    // Balances (orders-based wallet)
    paidOrdersRemaining: { type: Number, default: 0, min: 0 },
    bonusOrdersRemaining: { type: Number, default: 0, min: 0 },

    // For quick UI/locking
    totalOrdersRemaining: { type: Number, default: 0, min: 0 }, // paid + bonus

    // Settings
    bonusPercent: { type: Number, default: 15, min: 0, max: 100 }, // default 15% free
    consumePriority: {
      type: String,
      enum: ["bonus_first", "paid_first"],
      default: "bonus_first",
    },

    // Notify threshold (vendor can change; server enforces fallback too)
    notifyAtRemainingPercent: { type: Number, default: 5, min: 0, max: 100 }, // default 5%
    notifyAtRemainingOrders: { type: Number, default: 0, min: 0 }, // optional alternative threshold

    // Lockout rules
    orderingLocked: { type: Boolean, default: false },
    lockedAt: { type: Date, default: null },

    exhaustedAt: { type: Date, default: null }, // first time reaches 0
    graceDaysAfterExhausted: { type: Number, default: 2, min: 0, max: 30 },
    graceUntil: { type: Date, default: null }, // exhaustedAt + graceDays

    // Admin controls
    notes: { type: String, default: "" },

    // Maintenance / auditing
    lastRecalcAt: { type: Date, default: null },
    updatedByUserId: { type: String, default: "" },
  },
  { timestamps: true }
);

BranchWalletAccountSchema.pre("save", function (next) {
  const paid = Math.max(0, Number(this.paidOrdersRemaining || 0));
  const bonus = Math.max(0, Number(this.bonusOrdersRemaining || 0));
  this.paidOrdersRemaining = paid;
  this.bonusOrdersRemaining = bonus;
  this.totalOrdersRemaining = paid + bonus;
  next();
});

export default mongoose.model("BranchWalletAccount", BranchWalletAccountSchema);
