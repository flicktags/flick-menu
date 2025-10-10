// controllers/menuItemController.js
import MenuItem from "../models/MenuItem.js";
import Branch from "../models/Branch.js";
import Vendor from "../models/Vendor.js";

// --- helpers ---------------------------------------------------------
const toUpper = (v) => (typeof v === "string" ? v.toUpperCase().trim() : "");
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;
const isPositive = (n) => typeof n === "number" && n > 0;

function validateBusinessRules(payload) {
  const errs = [];

  // Names
  if (!isNonEmptyString(payload.nameEnglish)) errs.push("nameEnglish is required");
  if (!isNonEmptyString(payload.nameArabic)) errs.push("nameArabic is required");

  // Price model
  if (payload.isSizedBased === true) {
    if (!Array.isArray(payload.sizes) || payload.sizes.length === 0) {
      errs.push("sizes must be a non-empty array when isSizedBased=true");
    } else {
      for (const s of payload.sizes) {
        if (!isNonEmptyString(s.label)) errs.push("each size.label is required");
        if (!isPositive(Number(s.price))) errs.push("each size.price must be > 0");
      }
    }
    // When sized-based, fixedPrice should be 0 or omitted
    if (payload.fixedPrice && Number(payload.fixedPrice) > 0) {
      errs.push("fixedPrice must be 0 when isSizedBased=true");
    }
  } else {
    // Fixed price mode
    if (!isPositive(Number(payload.fixedPrice))) {
      errs.push("fixedPrice must be > 0 when isSizedBased=false");
    }
    // Offered price (if present) must be <= fixedPrice
    if (payload.offeredPrice != null) {
      const op = Number(payload.offeredPrice);
      if (isNaN(op) || op < 0) errs.push("offeredPrice must be >= 0");
      if (isPositive(Number(payload.fixedPrice)) && op > Number(payload.fixedPrice)) {
        errs.push("offeredPrice cannot be greater than fixedPrice");
      }
    }
  }

  // Discount
  if (payload.discount) {
    const { type, value, validUntil } = payload.discount;
    if (type && !["percentage", "amount"].includes(type)) {
      errs.push("discount.type must be 'percentage' or 'amount'");
    }
    if (value != null) {
      const v = Number(value);
      if (isNaN(v) || v <= 0) errs.push("discount.value must be > 0");
      if (type === "percentage" && v > 100) {
        errs.push("discount.value cannot exceed 100 when type=percentage");
      }
    }
    if (validUntil) {
      const d = new Date(validUntil);
      if (isNaN(d.getTime())) errs.push("discount.validUntil must be a valid ISO date");
    }
  }

  // Optional numerics
  if (payload.calories != null) {
    const cals = Number(payload.calories);
    if (isNaN(cals) || cals < 0) errs.push("calories must be >= 0");
  }
  if (payload.preparationTimeInMinutes != null) {
    const mins = Number(payload.preparationTimeInMinutes);
    if (isNaN(mins) || mins < 0) errs.push("preparationTimeInMinutes must be >= 0");
  }

  return errs;
}

async function userOwnsBranch(req, branch) {
  const uid = req.user?.uid;
  if (!uid) return false;
  if (!branch) return false;
  if (branch.userId === uid) return true;
  const vendor = await Vendor.findOne({ vendorId: branch.vendorId }).lean();
  if (vendor && vendor.userId === uid) return true;
  // Optionally: allow admin claim here
  return false;
}

// --- controller: CREATE ------------------------------------------------
export const createMenuItem = async (req, res) => {
  try {
    // 1) Resolve identifiers
    const branchIdParam = req.params.branchId || req.body.branchId;
    const sectionParam  = req.params.sectionKey || req.body.sectionKey;
    const branchId = String(branchIdParam || "").trim();
    const sectionKey = toUpper(sectionParam);

    if (!branchId) {
      return res.status(400).json({ code: "BRANCH_ID_REQUIRED", message: "branchId is required" });
    }
    if (!sectionKey) {
      return res.status(400).json({ code: "SECTION_KEY_REQUIRED", message: "sectionKey is required" });
    }

    // 2) Load branch + ownership
    const branch = await Branch.findOne({ branchId }).lean(false); // real doc if we later want to update counts
    if (!branch) return res.status(404).json({ code: "BRANCH_NOT_FOUND", message: "Branch not found" });

    if (!(await userOwnsBranch(req, branch))) {
      return res.status(403).json({ code: "FORBIDDEN", message: "You do not own this branch" });
    }

    // 3) **Validate section exists & is enabled**
    const sec = (branch.menuSections || []).find((s) => s.key === sectionKey);
    if (!sec || sec.isEnabled !== true) {
      return res.status(400).json({
        code: "SECTION_NOT_ENABLED",
        message: `Menu section '${sectionKey}' is not enabled on branch ${branchId}`,
        details: { enabledSections: (branch.menuSections || []).filter(s => s.isEnabled).map(s => s.key) }
      });
    }

    // 4) Build payload
    const payload = {
      branchId,
      vendorId: branch.vendorId, // trust server-side
      sectionKey,

      itemType: req.body.itemType,
      nameEnglish: req.body.nameEnglish,
      nameArabic: req.body.nameArabic,
      description: req.body.description ?? "",

      imageUrl: req.body.imageUrl ?? "",
      videoUrl: req.body.videoUrl ?? "",

      allergens: Array.isArray(req.body.allergens) ? req.body.allergens : [],
      tags: Array.isArray(req.body.tags) ? req.body.tags : [],

      isFeatured: !!req.body.isFeatured,
      isActive: req.body.isActive !== false,       // default true
      isAvailable: req.body.isAvailable !== false, // default true
      isSpicy: !!req.body.isSpicy,

      calories: req.body.calories ?? 0,
      sku: req.body.sku ?? "",
      preparationTimeInMinutes: req.body.preparationTimeInMinutes ?? 0,

      ingredients: Array.isArray(req.body.ingredients) ? req.body.ingredients : [],
      addons: Array.isArray(req.body.addons) ? req.body.addons : [],

      discount: req.body.discount || null,

      isSizedBased: !!req.body.isSizedBased,
      sizes: Array.isArray(req.body.sizes) ? req.body.sizes : [],

      fixedPrice: Number(req.body.fixedPrice ?? 0),
      offeredPrice: req.body.offeredPrice != null ? Number(req.body.offeredPrice) : null,

      sortOrder: Number(req.body.sortOrder ?? 0),
    };

    // 5) Business validation
    const errors = validateBusinessRules(payload);
    if (errors.length) {
      return res.status(400).json({ code: "VALIDATION_FAILED", message: "Invalid payload", errors });
    }

    // 6) Persist
    const item = await MenuItem.create(payload);

    // (Optional) Keep a fast counter in Branch.menuSections[i].itemCount
    try {
      const i = branch.menuSections.findIndex((s) => s.key === sectionKey);
      if (i >= 0) {
        // Only count active items in that section
        const activeCount = await MenuItem.countDocuments({ branchId, sectionKey, isActive: true });
        branch.menuSections[i].itemCount = activeCount;
        await branch.save();
      }
    } catch (e) {
      // not fatal
      console.warn("itemCount update failed:", e.message);
    }

    return res.status(201).json({ message: "Menu item created", item });
  } catch (err) {
    console.error("createMenuItem error:", err);
    return res.status(500).json({ code: "SERVER_ERROR", message: err.message });
  }
};
