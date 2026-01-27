// src/utils/branchOwnership.js
import Branch from "../models/Branch.js";
import Vendor from "../models/Vendor.js";

const asStr = (v, def = "") => (v == null ? def : String(v));

export async function assertUserOwnsBranch(req, branchId) {
  const bid = asStr(branchId).trim();
  if (!bid) return false;

  const uid = req.user?.uid || req.user?.id || null;
  if (!uid) return false;

  const branch = await Branch.findOne({ branchId: bid })
    .select("branchId vendorId userId")
    .lean();

  if (!branch) return false;

  if (branch.userId && String(branch.userId) === String(uid)) return true;

  const vendor = await Vendor.findOne({ vendorId: branch.vendorId })
    .select("userId")
    .lean();

  if (vendor?.userId && String(vendor.userId) === String(uid)) return true;

  if (req.user?.isAdmin === true) return true;

  return false;
}
