// controller/themeMappingController.js
import ThemeMapping from "../model/ThemeMapping.js";
import Branch from "../models/Branch.js";
import Vendor from "../models/Vendor.js";

/** utils */
const asStr = (v, def = "") => (v == null ? def : String(v));
const asUpper = (v, def = "") => asStr(v, def).trim().toUpperCase();

// 01..08 only
const isValidDesignCode = (v) => typeof v === "string" && /^0[1-8]$/.test(v);

/**
 * Ownership check:
 * - Branch must exist and belong to vendorId provided.
 * - And the authenticated user must own either the branch (branch.userId === req.user.uid)
 *   or the vendor (vendor.userId === req.user.uid).
 * Adjust field names if your Vendor/Branch schemas differ (e.g., ownerUid).
 */
async function assertVendorUserOwnsBranch(req, vendorId, branchId) {
  if (!vendorId || !branchId) return false;

  const branch = await Branch.findOne({ branchId }).select("vendorId userId").lean();
  if (!branch) return false;
  if (branch.vendorId !== vendorId) return false;

  const uid = req.user?.uid || req.user?.id || null;
  if (!uid) return false;

  // Accept if branch.userId matches
  if (branch.userId && String(branch.userId) === String(uid)) return true;

  // Or if vendor.userId matches
  const vendor = await Vendor.findOne({ vendorId }).select("userId").lean();
  if (vendor && vendor.userId && String(vendor.userId) === String(uid)) return true;

  // (Optional) Allow admins:
  if (req.user?.isAdmin === true) return true;

  return false;
}

/**
 * GET /api/vendor/theme-mapping?vendorId=...&branch=...&sectionKey=...
 * Auth: Firebase
 * Response: { itemTypeDesignMap: { "Pizza": "01", ... } }
 */
export const getThemeMappingVendor = async (req, res) => {
  try {
    const vendorId   = asStr(req.query.vendorId).trim();
    const branchId   = asStr(req.query.branch).trim();
    const sectionKey = asUpper(req.query.sectionKey);

    if (!vendorId || !branchId || !sectionKey) {
      return res.status(400).json({ error: "vendorId, branch, sectionKey are required" });
    }

    const ok = await assertVendorUserOwnsBranch(req, vendorId, branchId);
    if (!ok) return res.status(403).json({ error: "Forbidden" });

    const doc = await ThemeMapping.findOne({ vendorId, branchId, sectionKey }).lean();
    const mapObj = doc?.itemTypeDesignMap || {};

    return res.json({ itemTypeDesignMap: mapObj });
  } catch (e) {
    console.error("[ThemeMapping][GET] error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * PUT /api/vendor/theme-mapping
 * Body: { vendorId, branchId, sectionKey, itemTypeDesignMap: { "Coffee":"06", ... } }
 * Auth: Firebase
 * Response: { ok: true, itemTypeDesignMap: {...} }
 */
export const upsertThemeMappingVendor = async (req, res) => {
  try {
    const vendorId   = asStr(req.body.vendorId).trim();
    const branchId   = asStr(req.body.branchId).trim();
    const sectionKey = asUpper(req.body.sectionKey);
    const rawMap     = req.body.itemTypeDesignMap;

    if (!vendorId || !branchId || !sectionKey || typeof rawMap !== "object" || rawMap == null) {
      return res.status(400).json({ error: "vendorId, branchId, sectionKey, itemTypeDesignMap are required" });
    }

    const ok = await assertVendorUserOwnsBranch(req, vendorId, branchId);
    if (!ok) return res.status(403).json({ error: "Forbidden" });

    // Normalize & validate codes
    const clean = {};
    for (const [k, v] of Object.entries(rawMap)) {
      const itemType = asStr(k).trim();
      const code = asStr(v).padStart(2, "0");
      if (!itemType) continue;
      if (!isValidDesignCode(code)) {
        return res.status(400).json({ error: `Invalid design code for '${itemType}': '${v}'. Allowed: 01..08` });
      }
      clean[itemType] = code;
    }

    const upsert = await ThemeMapping.findOneAndUpdate(
      { vendorId, branchId, sectionKey },
      { vendorId, branchId, sectionKey, itemTypeDesignMap: clean },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    return res.json({ ok: true, itemTypeDesignMap: upsert.itemTypeDesignMap || {} });
  } catch (e) {
    // Unique index violation guard (race)
    if (e?.code === 11000) {
      try {
        const { vendorId, branchId } = req.body;
        const sectionKey = asUpper(req.body.sectionKey);
        const doc = await ThemeMapping.findOne({ vendorId, branchId, sectionKey }).lean();
        return res.json({ ok: true, itemTypeDesignMap: doc?.itemTypeDesignMap || {} });
      } catch (e2) {
        console.error("[ThemeMapping][PUT][11000 followup] error:", e2);
      }
    }
    console.error("[ThemeMapping][PUT] error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
};
