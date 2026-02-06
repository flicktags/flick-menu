// ===============================
// ✅ 5) CONTROLLER: Wallet + Ledger APIs
// File: src/controllers/walletController.js
// ===============================
import mongoose from "mongoose";
import BranchWalletAccount from "../models/BranchWalletAccount.js";
import BillingLedger from "../models/BillingLedger.js";
import { generateLedgerId, readBranchUnitFeeFils, computeTopupOrders } from "../utils/billingWallet.js";
import { debitWalletForOrder } from "../utils/walletDebit.js";


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

// ✅ GET wallet summary
export async function getWalletSummary(req, res) {
  try {
    const branchId = String(req.query.branchId || "").trim();
    if (!branchId) return res.status(400).json({ ok: false, message: "branchId required" });

    const doc = await BranchWalletAccount.findOne({ branchId });
    return res.json({ ok: true, wallet: doc || null });
  } catch (e) {
    return res.status(500).json({ ok: false, message: "SERVER_ERROR" });
  }
}

// ✅ GET ledger (paged)
export async function getLedger(req, res) {
  try {
    const branchId = String(req.query.branchId || "").trim();
    if (!branchId) return res.status(400).json({ ok: false, message: "branchId required" });

    const page = Math.max(1, asInt(req.query.page, 1));
    const limit = Math.min(100, Math.max(10, asInt(req.query.limit, 30)));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      BillingLedger.find({ branchId }).sort({ createdAt: -1 }).skip(skip).limit(limit),
      BillingLedger.countDocuments({ branchId }),
    ]);

    return res.json({
      ok: true,
      page,
      limit,
      total,
      items,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, message: "SERVER_ERROR" });
  }
}

// ✅ MANUAL TOPUP (frontend sample now; gateway fields empty)
// POST /api/admin/wallet/topup/manual
// body: { branchId, amountFils OR amountBhd, bonusPercent?, idempotencyKey? }
export async function manualTopup(req, res) {
  const session = await mongoose.startSession();

  try {
    const actorUserId = req.user?.uid || "";

    const branchId = String(req.body.branchId || "").trim();
    if (!branchId) {
      return res.status(400).json({ ok: false, message: "branchId required" });
    }

    // amount input
    const amountFilsBody = req.body.amountFils;
    const amountBhdBody = req.body.amountBhd;

    let amountFils = 0;
    if (amountFilsBody != null) {
      amountFils = asInt(amountFilsBody, 0);
    } else if (amountBhdBody != null) {
      // 1 BHD = 1000 fils
      const bhd = Number(amountBhdBody);
      amountFils = Number.isFinite(bhd) ? Math.round(bhd * 1000) : 0;
    }

    if (amountFils <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "amountFils/amountBhd must be > 0" });
    }

    const bonusPercent = Math.min(
      100,
      Math.max(0, Number(req.body.bonusPercent ?? 15))
    );

    const idemKey = String(req.body.idempotencyKey || "").trim(); // optional

    // We'll store the result here and respond AFTER the transaction commits
    let result = null;

    await session.withTransaction(async () => {
      // -------------------- Idempotency check --------------------
      if (idemKey) {
        const exists = await BillingLedger.findOne({ idempotencyKey: idemKey })
          .session(session);

        if (exists) {
          // ✅ Do NOT res.json() here (inside txn). Just store result and return.
          result = {
            reused: true,
            ledger: exists,
            wallet: null,
            vendorId: exists.vendorId,
            branchId: exists.branchId,
          };
          return;
        }
      }

      // -------------------- Read fee from branch --------------------
      const { feeFils, vendorId } = await readBranchUnitFeeFils(branchId, session);

      if (feeFils <= 0) {
        throw new Error("PLATFORM_FEE_NOT_SET");
      }

      const { paidOrders, bonusOrders } = computeTopupOrders(
        amountFils,
        feeFils,
        bonusPercent
      );

      if (paidOrders <= 0) {
        throw new Error("TOPUP_TOO_SMALL_FOR_FEE");
      }

      // -------------------- Upsert wallet account --------------------
      // ✅ FIX: vendorId MUST NOT be in $set AND $setOnInsert together
      const wallet = await BranchWalletAccount.findOneAndUpdate(
        { branchId },
        {
          $setOnInsert: {
            branchId,
            vendorId,
            bonusPercent,
            consumePriority: "bonus_first",
            notifyAtRemainingPercent: 5,
            graceDaysAfterExhausted: 2,
          },
          $set: {
            // vendorId: vendorId,  // ❌ REMOVED to avoid conflict
            updatedByUserId: actorUserId,

            // OPTIONAL: if you want bonusPercent to update every time:
            // bonusPercent,
          },
          $inc: {
            paidOrdersRemaining: paidOrders,
            bonusOrdersRemaining: bonusOrders,
          },
        },
        { new: true, upsert: true, session }
      );

      // If wallet was locked / exhausted, unlock on topup
      wallet.orderingLocked = false;
      wallet.lockedAt = null;
      wallet.exhaustedAt = null;
      wallet.graceUntil = null;
      await wallet.save({ session });

      // -------------------- Ledger entry --------------------
      const ledgerId = await generateLedgerId();

      const led = await BillingLedger.create(
        [
          {
            ledgerId,
            branchId,
            vendorId,
            actorUserId,
            actorRole: "vendor", // or "admin" later

            entryType: "TOPUP",
            direction: "CREDIT",

            amountFils,
            currency: "BHD",

            unitFeeFils: feeFils,
            ordersPurchased: paidOrders,
            bonusOrdersGranted: bonusOrders,

            status: "succeeded",
            // idempotencyKey: idemKey || "",
            ...(idemKey ? { idempotencyKey: idemKey } : {}), // ✅ only store when provided


            payment: {
              provider: "",
              status: "",
              transactionId: "",
              merchantReference: "",
              authCode: "",
              resultCode: "",
              paidAt: null,
              raw: null,
            },

            snapshotAfter: {
              paidOrdersRemaining: wallet.paidOrdersRemaining,
              bonusOrdersRemaining: wallet.bonusOrdersRemaining,
              totalOrdersRemaining: wallet.totalOrdersRemaining,
            },

            title: "Manual wallet top-up (sample)",
            note: `Topup amount=${amountFils} fils, fee=${feeFils} fils/order, bonus=${bonusPercent}%`,
            meta: { bonusPercent },
          },
        ],
        { session }
      );

      result = {
        reused: false,
        wallet,
        ledger: led[0],
      };
    });

    // -------------------- Respond AFTER txn --------------------
    if (!result) {
      // This should never happen, but safe guard
      return res.status(500).json({ ok: false, message: "UNKNOWN_ERROR" });
    }

    if (result.reused) {
      return res.status(200).json({
        ok: true,
        reused: true,
        wallet: result.wallet,
        ledger: result.ledger,
      });
    }

    return res.status(201).json({
      ok: true,
      wallet: result.wallet,
      ledger: result.ledger,
    });
  } catch (e) {
    const msg = String(e?.message || e);

    // If you want to treat some messages as server errors:
    // return res.status(500) for unexpected.
    const known400 = new Set([
      "branchId required",
      "amountFils/amountBhd must be > 0",
      "PLATFORM_FEE_NOT_SET",
      "TOPUP_TOO_SMALL_FOR_FEE",
      "BRANCH_NOT_FOUND",
    ]);

    const statusCode = known400.has(msg) ? 400 : 500;

    if (!res.headersSent) {
      return res.status(statusCode).json({ ok: false, message: msg });
    }
  } finally {
    session.endSession();
  }
}


// ✅ UPDATE SETTINGS (notify threshold, consume priority)
// POST /api/admin/wallet/settings
// body: { branchId, notifyAtRemainingPercent?, notifyAtRemainingOrders?, consumePriority?, graceDaysAfterExhausted? }
export async function updateWalletSettings(req, res) {
  try {
    const actorUserId = req.user?.uid || "";
    const branchId = String(req.body.branchId || "").trim();
    if (!branchId) return res.status(400).json({ ok: false, message: "branchId required" });

    const patch = {};
    if (req.body.notifyAtRemainingPercent != null) {
      patch.notifyAtRemainingPercent = Math.min(100, Math.max(0, Number(req.body.notifyAtRemainingPercent)));
    }
    if (req.body.notifyAtRemainingOrders != null) {
      patch.notifyAtRemainingOrders = Math.max(0, asInt(req.body.notifyAtRemainingOrders, 0));
    }
    if (req.body.consumePriority) {
      const p = String(req.body.consumePriority).trim();
      if (["bonus_first", "paid_first"].includes(p)) patch.consumePriority = p;
    }
    if (req.body.graceDaysAfterExhausted != null) {
      patch.graceDaysAfterExhausted = Math.min(30, Math.max(0, asInt(req.body.graceDaysAfterExhausted, 2)));
    }

    patch.updatedByUserId = actorUserId;

    const doc = await BranchWalletAccount.findOneAndUpdate({ branchId }, { $set: patch }, { new: true });
    return res.json({ ok: true, wallet: doc || null });
  } catch (e) {
    return res.status(500).json({ ok: false, message: "SERVER_ERROR" });
  }
}

// ✅ DEBIT 1 ORDER (called when KDS ACCEPTS the order)
// POST /api/internal/wallet/debit-on-accept
// body: { branchId, orderId, orderNumber? }
// IMPORTANT: call this from your "accept order" API right after accept succeeds.

export async function debitOnOrderAccept(req, res) {
  const session = await mongoose.startSession();
  let result = null;

  try {
    const actorUserId = req.user?.uid || "";

    const branchId = String(req.body.branchId || "").trim();
    const orderId = String(req.body.orderId || "").trim();
    const orderNumber = String(req.body.orderNumber || "").trim();

    if (!branchId || !orderId) {
      return res.status(400).json({ ok: false, message: "branchId and orderId required" });
    }

    await session.withTransaction(async () => {
      result = await debitWalletForOrder({
        session,
        branchId,
        orderId,
        orderNumber,
        actorUserId,
        actorRole: "system",
      });
    });

    return res.status(result?.reused ? 200 : 201).json({
      ok: true,
      reused: !!result?.reused,
      wallet: result?.wallet ?? null,
      ledger: result?.ledger ?? null,
    });
  } catch (e) {
    const msg = String(e?.message || e);

    const map = {
      "branchId and orderId required": 400,
      PLATFORM_FEE_NOT_SET: 400,
      WALLET_NOT_FOUND: 403,
      ORDERING_LOCKED: 403,
      WALLET_EXHAUSTED: 403,
      INSUFFICIENT_ORDERS: 403,
    };

    const code = map[msg] || 500;
    return res.status(code).json({ ok: false, message: msg });
  } finally {
    session.endSession();
  }
}

// export async function debitOnOrderAccept(req, res) {
//   const session = await mongoose.startSession();
//   try {
//     const actorUserId = req.user?.uid || "";

//     const branchId = String(req.body.branchId || "").trim();
//     const orderId = String(req.body.orderId || "").trim();
//     const orderNumber = String(req.body.orderNumber || "").trim();

//     if (!branchId || !orderId) {
//       return res.status(400).json({ ok: false, message: "branchId and orderId required" });
//     }

//     const idemKey = `ORDER_DEBIT:${orderId}`;

//     await session.withTransaction(async () => {
//       // Idempotency: if already debited, return same result
//       const already = await BillingLedger.findOne({ idempotencyKey: idemKey }).session(session);
//       if (already) {
//         return res.status(200).json({ ok: true, reused: true, ledger: already });
//       }

//       const { feeFils, vendorId } = await readBranchUnitFeeFils(branchId, session);

//       // Ensure wallet exists
//       const wallet = await BranchWalletAccount.findOne({ branchId }).session(session);
//       if (!wallet) {
//         // No wallet => lock ordering by policy (or allow free until wallet created)
//         // You said: browsing works, ordering locks out.
//         throw new Error("WALLET_NOT_FOUND");
//       }

//       // If locked AND grace expired => block
//       if (wallet.orderingLocked === true) {
//         // If grace exists and still valid, allow (optional)
//         if (!wallet.graceUntil || new Date() > new Date(wallet.graceUntil)) {
//           throw new Error("ORDERING_LOCKED");
//         }
//       }

//       // If total is 0 => set exhausted & grace then lock (your rules)
//       if (wallet.totalOrdersRemaining <= 0) {
//         if (!wallet.exhaustedAt) wallet.exhaustedAt = new Date();
//         wallet.graceUntil = nowPlusDays(wallet.graceDaysAfterExhausted || 2);
//         wallet.orderingLocked = true;
//         wallet.lockedAt = new Date();
//         await wallet.save({ session });
//         throw new Error("WALLET_EXHAUSTED");
//       }

//       // Consume based on priority
//       const priority = wallet.consumePriority || "bonus_first";

//       if (priority === "bonus_first") {
//         if (wallet.bonusOrdersRemaining > 0) {
//           wallet.bonusOrdersRemaining -= 1;
//         } else if (wallet.paidOrdersRemaining > 0) {
//           wallet.paidOrdersRemaining -= 1;
//         } else {
//           // should not happen because total > 0, but safe
//           throw new Error("INSUFFICIENT_ORDERS");
//         }
//       } else {
//         // paid_first
//         if (wallet.paidOrdersRemaining > 0) {
//           wallet.paidOrdersRemaining -= 1;
//         } else if (wallet.bonusOrdersRemaining > 0) {
//           wallet.bonusOrdersRemaining -= 1;
//         } else {
//           throw new Error("INSUFFICIENT_ORDERS");
//         }
//       }

//       // Recompute + lock if now exhausted
//       if ((wallet.paidOrdersRemaining + wallet.bonusOrdersRemaining) <= 0) {
//         wallet.exhaustedAt = new Date();
//         wallet.graceUntil = nowPlusDays(wallet.graceDaysAfterExhausted || 2);
//         wallet.orderingLocked = true;
//         wallet.lockedAt = new Date();
//       }

//       await wallet.save({ session });

//       const ledgerId = await generateLedgerId();
//       const led = await BillingLedger.create(
//         [
//           {
//             ledgerId,
//             branchId,
//             vendorId,
//             actorUserId,
//             actorRole: "system", // because it happens on accept
//             entryType: "ORDER_DEBIT",
//             direction: "DEBIT",
//             amountFils: feeFils, // informational for audit
//             currency: "BHD",
//             unitFeeFils: feeFils,
//             ordersDebited: 1,
//             orderId,
//             orderNumber,
//             status: "succeeded",
//             idempotencyKey: idemKey,
//             payment: {
//               provider: "",
//               status: "",
//               transactionId: "",
//               merchantReference: "",
//               authCode: "",
//               resultCode: "",
//               paidAt: null,
//               raw: null,
//             },
//             snapshotAfter: {
//               paidOrdersRemaining: wallet.paidOrdersRemaining,
//               bonusOrdersRemaining: wallet.bonusOrdersRemaining,
//               totalOrdersRemaining: wallet.totalOrdersRemaining,
//             },
//             title: "Order fee deducted on accept",
//             note: `Deducted 1 order at fee=${feeFils} fils (priority=${priority})`,
//           },
//         ],
//         { session }
//       );

//       return res.status(201).json({ ok: true, wallet, ledger: led[0] });
//     });
//   } catch (e) {
//     const msg = String(e?.message || e);

//     // Policy mapping
//     const map = {
//       WALLET_NOT_FOUND: 403,
//       ORDERING_LOCKED: 403,
//       WALLET_EXHAUSTED: 403,
//       PLATFORM_FEE_NOT_SET: 400,
//     };
//     const code = map[msg] || 400;

//     if (!res.headersSent) {
//       return res.status(code).json({ ok: false, message: msg });
//     }
//   } finally {
//     session.endSession();
//   }
// }
