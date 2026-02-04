import mongoose from "mongoose";
import Branch from "../models/Branch.js";
import BranchWalletAccount from "../models/BranchWalletAccount.js";
import BillingLedger from "../models/BillingLedger.js";


function pad(n, w) {
  const s = String(n);
  return s.length >= w ? s : "0".repeat(w - s.length) + s;
}

// Simple unique ledgerId generator (OK for moderate load)
// If you already have a global counter util, plug it here.
export async function generateLedgerId() {
  const now = new Date();
  const y = now.getFullYear();
  const m = pad(now.getMonth() + 1, 2);
  const d = pad(now.getDate(), 2);
  const rand = pad(Math.floor(Math.random() * 1000000), 6);
  return `LED-${y}${m}${d}-${rand}`;
}

export async function readBranchUnitFeeFils(branchId, session) {
  const br = await Branch.findOne({ branchId }, { taxes: 1, vendorId: 1 }).session(session);
  if (!br) throw new Error("BRANCH_NOT_FOUND");

  // IMPORTANT:
  // You told: platformFeePerOrder should be integer fils (e.g. 30)
  // We'll treat it as fils here. (If null => ordering should still work but fee = 0.)
  const fee = br?.taxes?.platformFeePerOrder;
  const feeFils = Number.isFinite(fee) ? Math.max(0, Math.round(fee)) : 0;

  return { feeFils, vendorId: br.vendorId };
}

export function computeTopupOrders(amountFils, unitFeeFils, bonusPercent = 15) {
  const fee = Math.max(1, Number(unitFeeFils || 0)); // avoid division by zero
  const paidOrders = Math.floor(Math.max(0, amountFils) / fee);
  const bonusOrders = Math.floor((paidOrders * Math.max(0, bonusPercent)) / 100);
  return { paidOrders, bonusOrders };
}
