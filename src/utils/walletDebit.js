import mongoose from "mongoose";
import BranchWalletAccount from "../models/BranchWalletAccount.js";
import BillingLedger from "../models/BillingLedger.js";
import { generateLedgerId, readBranchUnitFeeFils } from "./billingWallet.js";

function asInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function nowPlusDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + asInt(days, 0));
  return d;
}

/**
 * ✅ Debit wallet for an order (idempotent per order)
 * - No res.json here
 * - Safe to call from KDS accept flow
 */
export async function debitWalletForOrder({
  session,
  branchId,
  orderId,
  orderNumber = "",
  actorUserId = "",
  actorRole = "system",
}) {
  if (!branchId || !orderId) throw new Error("branchId and orderId required");

  const idemKey = `ORDER_DEBIT:${orderId}`;

  // 1) idempotency check
  const existing = await BillingLedger.findOne({ idempotencyKey: idemKey }).session(session);
  if (existing) {
    return { reused: true, ledger: existing, wallet: null };
  }

  // 2) fee + vendor
  const { feeFils, vendorId } = await readBranchUnitFeeFils(branchId, session);
  if (feeFils <= 0) throw new Error("PLATFORM_FEE_NOT_SET");

  // 3) wallet
  const wallet = await BranchWalletAccount.findOne({ branchId }).session(session);
  if (!wallet) throw new Error("WALLET_NOT_FOUND");

  // if locked AND grace expired => block
  if (wallet.orderingLocked === true) {
    if (!wallet.graceUntil || new Date() > new Date(wallet.graceUntil)) {
      throw new Error("ORDERING_LOCKED");
    }
  }

  // total check
  if ((wallet.totalOrdersRemaining || 0) <= 0) {
    if (!wallet.exhaustedAt) wallet.exhaustedAt = new Date();
    wallet.graceUntil = nowPlusDays(wallet.graceDaysAfterExhausted || 2);
    wallet.orderingLocked = true;
    wallet.lockedAt = new Date();
    await wallet.save({ session });
    throw new Error("WALLET_EXHAUSTED");
  }

  // 4) consume logic
  const priority = wallet.consumePriority || "bonus_first";

  if (priority === "bonus_first") {
    if ((wallet.bonusOrdersRemaining || 0) > 0) wallet.bonusOrdersRemaining -= 1;
    else if ((wallet.paidOrdersRemaining || 0) > 0) wallet.paidOrdersRemaining -= 1;
    else throw new Error("INSUFFICIENT_ORDERS");
  } else {
    if ((wallet.paidOrdersRemaining || 0) > 0) wallet.paidOrdersRemaining -= 1;
    else if ((wallet.bonusOrdersRemaining || 0) > 0) wallet.bonusOrdersRemaining -= 1;
    else throw new Error("INSUFFICIENT_ORDERS");
  }

  // lock if becomes 0
  const afterTotal = (wallet.paidOrdersRemaining || 0) + (wallet.bonusOrdersRemaining || 0);
  if (afterTotal <= 0) {
    wallet.exhaustedAt = new Date();
    wallet.graceUntil = nowPlusDays(wallet.graceDaysAfterExhausted || 2);
    wallet.orderingLocked = true;
    wallet.lockedAt = new Date();
  }

  await wallet.save({ session });

  // 5) ledger entry
  const ledgerId = await generateLedgerId();

  const created = await BillingLedger.create(
    [
      {
        ledgerId,
        branchId,
        vendorId,

        actorUserId,
        actorRole,

        entryType: "ORDER_DEBIT",
        direction: "DEBIT",

        amountFils: feeFils, // audit value
        currency: "BHD",

        unitFeeFils: feeFils,
        ordersDebited: 1,

        orderId,
        orderNumber,

        status: "succeeded",
        idempotencyKey: idemKey,

        snapshotAfter: {
          paidOrdersRemaining: wallet.paidOrdersRemaining,
          bonusOrdersRemaining: wallet.bonusOrdersRemaining,
          totalOrdersRemaining: wallet.totalOrdersRemaining,
        },

        title: "Order fee deducted on accept",
        note: `Deducted 1 order at fee=${feeFils} fils (priority=${priority})`,
      },
    ],
    { session }
  );

  return { reused: false, wallet, ledger: created[0] };
}
