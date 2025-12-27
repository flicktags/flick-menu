// controller/branchCustomMenuTypesController.js
import crypto from "crypto";
import Branch from "../models/Branch.js";
import Vendor from "../models/Vendor.js";

// ✅ Optional: if you already have this helper, import it instead of re-creating.
// import { touchBranchMenuStampByBizId } from "../utils/menuStamp.js";
import { touchBranchMenuStampByBizId } from "../utils/touchMenuStamp.js"; // adjust path if needed

/** utils */
const asStr = (v, def = "") => (v == null ? def : String(v));
const asInt = (v, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
};

function makeCustomCode() {
  // CUST_ + 6 chars
  const rand = crypto.randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
  return `CUST_${rand}`;
}

/**
 * Ownership check:
 * - branch must exist
 * - req.user.uid must match either branch.userId or vendor.userId
 */
async function assertUserOwnsBranch(req, branchId) {
  const bid = asStr(branchId).trim();
  if (!bid) return false;

  const uid = req.user?.uid || req.user?.id || null;
  if (!uid) return false;

  const branch = await Branch.findOne({ branchId: bid })
    .select("branchId vendorId userId")
    .lean();

  if (!branch) return false;

  // Branch owner
  if (branch.userId && String(branch.userId) === String(uid)) return true;

  // Vendor owner
  const vendor = await Vendor.findOne({ vendorId: branch.vendorId })
    .select("userId")
    .lean();

  if (vendor?.userId && String(vendor.userId) === String(uid)) return true;

  // Admin override (optional)
  if (req.user?.isAdmin === true) return true;

  return false;
}

/**
 * GET /api/vendor/branches/:branchId/custom-menu-types
 * Auth: Firebase
 * Response: { branchId, vendorId, customMenuTypes: [...] }
 */
export const getCustomMenuTypes = async (req, res) => {
  try {
    const branchId = asStr(req.params.branchId).trim();
    if (!branchId) return res.status(400).json({ error: "branchId required" });

    const ok = await assertUserOwnsBranch(req, branchId);
    if (!ok) return res.status(403).json({ error: "Forbidden" });

    const branch = await Branch.findOne({ branchId })
      .select("branchId vendorId customMenuTypes")
      .lean();

    return res.json({
      branchId: branch.branchId,
      vendorId: branch.vendorId,
      customMenuTypes: branch.customMenuTypes || [],
    });
  } catch (e) {
    console.error("[CustomMenuTypes][GET] error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * POST /api/vendor/branches/:branchId/custom-menu-types
 * Body: { nameEnglish, nameArabic?, imageUrl?, sortOrder?, isActive? }
 * Response: { ok:true, item, customMenuTypes:[...] }
 */
export const createCustomMenuType = async (req, res) => {
  try {
    const branchId = asStr(req.params.branchId).trim();
    if (!branchId) return res.status(400).json({ error: "branchId required" });

    const ok = await assertUserOwnsBranch(req, branchId);
    if (!ok) return res.status(403).json({ error: "Forbidden" });

    const nameEnglish = asStr(req.body.nameEnglish).trim();
    const nameArabic = asStr(req.body.nameArabic).trim();
    const imageUrl = asStr(req.body.imageUrl).trim();
    const sortOrder = asInt(req.body.sortOrder, 0);
    const isActive =
      typeof req.body.isActive === "boolean"
        ? req.body.isActive
        : asStr(req.body.isActive).toLowerCase() === "true";

    if (!nameEnglish) {
      return res.status(400).json({ error: "nameEnglish is required" });
    }

    const branch = await Branch.findOne({ branchId }).select(
      "branchId vendorId customMenuTypes"
    );
    if (!branch) return res.status(404).json({ error: "Branch not found" });

    // Generate unique code inside this branch
    let code = makeCustomCode();
    const existingCodes = new Set(
      (branch.customMenuTypes || []).map((x) => String(x.code || ""))
    );
    let attempts = 0;
    while (existingCodes.has(code) && attempts < 5) {
      code = makeCustomCode();
      attempts++;
    }
    if (existingCodes.has(code)) {
      return res
        .status(500)
        .json({ error: "Could not generate unique code, try again" });
    }

    const now = new Date();
    const item = {
      code,
      nameEnglish,
      nameArabic,
      imageUrl,
      isActive: req.body.isActive === undefined ? true : isActive,
      sortOrder,
      createdAt: now,
      updatedAt: now,
    };

    branch.customMenuTypes = branch.customMenuTypes || [];
    branch.customMenuTypes.push(item);
    await branch.save();

    // ✅ bump menuVersion/menuUpdatedAt so public UI knows to refresh
    try {
      await touchBranchMenuStampByBizId(branchId);
    } catch (e) {
      console.warn("[CustomMenuTypes][POST] touch stamp failed:", e?.message);
    }

    return res.json({
      ok: true,
      item,
      customMenuTypes: branch.customMenuTypes,
    });
  } catch (e) {
    console.error("[CustomMenuTypes][POST] error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * PUT /api/vendor/branches/:branchId/custom-menu-types/:code
 * Body: { nameEnglish?, nameArabic?, imageUrl?, sortOrder?, isActive? }
 * Response: { ok:true, item, customMenuTypes:[...] }
 */
export const updateCustomMenuType = async (req, res) => {
  try {
    const branchId = asStr(req.params.branchId).trim();
    const code = asStr(req.params.code).trim();

    if (!branchId || !code) {
      return res.status(400).json({ error: "branchId and code are required" });
    }

    const ok = await assertUserOwnsBranch(req, branchId);
    if (!ok) return res.status(403).json({ error: "Forbidden" });

    const branch = await Branch.findOne({ branchId }).select("customMenuTypes");
    if (!branch) return res.status(404).json({ error: "Branch not found" });

    const list = branch.customMenuTypes || [];
    const idx = list.findIndex((x) => String(x.code) === code);
    if (idx === -1) {
      return res.status(404).json({ error: "Custom menu type not found" });
    }

    const item = list[idx];
    const now = new Date();

    // Apply changes only if provided
    if (req.body.nameEnglish !== undefined) {
      const v = asStr(req.body.nameEnglish).trim();
      if (!v) return res.status(400).json({ error: "nameEnglish cannot be empty" });
      item.nameEnglish = v;
    }
    if (req.body.nameArabic !== undefined) item.nameArabic = asStr(req.body.nameArabic).trim();
    if (req.body.imageUrl !== undefined) item.imageUrl = asStr(req.body.imageUrl).trim();
    if (req.body.sortOrder !== undefined) item.sortOrder = asInt(req.body.sortOrder, item.sortOrder ?? 0);

    if (req.body.isActive !== undefined) {
      item.isActive =
        typeof req.body.isActive === "boolean"
          ? req.body.isActive
          : asStr(req.body.isActive).toLowerCase() === "true";
    }

    item.updatedAt = now;
    branch.customMenuTypes = list;

    await branch.save();

    try {
      await touchBranchMenuStampByBizId(branchId);
    } catch (e) {
      console.warn("[CustomMenuTypes][PUT] touch stamp failed:", e?.message);
    }

    return res.json({
      ok: true,
      item,
      customMenuTypes: branch.customMenuTypes,
    });
  } catch (e) {
    console.error("[CustomMenuTypes][PUT] error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * DELETE /api/vendor/branches/:branchId/custom-menu-types/:code
 * Response: { ok:true, customMenuTypes:[...] }
 */
export const deleteCustomMenuType = async (req, res) => {
  try {
    const branchId = asStr(req.params.branchId).trim();
    const code = asStr(req.params.code).trim();

    if (!branchId || !code) {
      return res.status(400).json({ error: "branchId and code are required" });
    }

    const ok = await assertUserOwnsBranch(req, branchId);
    if (!ok) return res.status(403).json({ error: "Forbidden" });

    const branch = await Branch.findOne({ branchId }).select("customMenuTypes");
    if (!branch) return res.status(404).json({ error: "Branch not found" });

    const before = (branch.customMenuTypes || []).length;
    branch.customMenuTypes = (branch.customMenuTypes || []).filter(
      (x) => String(x.code) !== code
    );

    if (branch.customMenuTypes.length === before) {
      return res.status(404).json({ error: "Custom menu type not found" });
    }

    await branch.save();

    try {
      await touchBranchMenuStampByBizId(branchId);
    } catch (e) {
      console.warn("[CustomMenuTypes][DELETE] touch stamp failed:", e?.message);
    }

    return res.json({
      ok: true,
      customMenuTypes: branch.customMenuTypes,
    });
  } catch (e) {
    console.error("[CustomMenuTypes][DELETE] error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * PUT /api/vendor/branches/:branchId/custom-menu-types/reorder
 * Body: { order: ["CUST_XXXXXX", "CUST_YYYYYY", ...] }
 * Response: { ok:true, customMenuTypes:[...] }
 */
export const reorderCustomMenuTypes = async (req, res) => {
  try {
    const branchId = asStr(req.params.branchId).trim();
    const order = req.body?.order;

    if (!branchId) return res.status(400).json({ error: "branchId required" });
    if (!Array.isArray(order) || order.length === 0) {
      return res.status(400).json({ error: "order array is required" });
    }

    const ok = await assertUserOwnsBranch(req, branchId);
    if (!ok) return res.status(403).json({ error: "Forbidden" });

    const branch = await Branch.findOne({ branchId }).select("customMenuTypes");
    if (!branch) return res.status(404).json({ error: "Branch not found" });

    const list = branch.customMenuTypes || [];
    const map = new Map(list.map((x) => [String(x.code), x]));

    // apply new sortOrder based on order index
    const now = new Date();
    for (let i = 0; i < order.length; i++) {
      const code = asStr(order[i]).trim();
      const item = map.get(code);
      if (item) {
        item.sortOrder = i;
        item.updatedAt = now;
      }
    }

    // keep items not included at end
    const included = new Set(order.map((x) => String(x)));
    const rest = list.filter((x) => !included.has(String(x.code)));
    rest.forEach((x, idx) => {
      x.sortOrder = order.length + idx;
      x.updatedAt = now;
    });

    // re-sort
    branch.customMenuTypes = [...list].sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    );

    await branch.save();

    try {
      await touchBranchMenuStampByBizId(branchId);
    } catch (e) {
      console.warn("[CustomMenuTypes][REORDER] touch stamp failed:", e?.message);
    }

    return res.json({ ok: true, customMenuTypes: branch.customMenuTypes });
  } catch (e) {
    console.error("[CustomMenuTypes][REORDER] error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
};
