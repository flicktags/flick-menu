// controllers/menuItemController.js
import MenuItem from "../models/MenuItem.js";
import Branch from "../models/Branch.js";
import Vendor from "../models/Vendor.js";

// ---------------- helpers ----------------
const toUpper = (v) => (typeof v === "string" ? v.toUpperCase().trim() : "");
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;
const isPositive = (n) => typeof n === "number" && n > 0;

async function userOwnsBranch(req, branch) {
  const uid = req.user?.uid;
  if (!uid || !branch) return false;
  if (branch.userId === uid) return true;
  const vendor = await Vendor.findOne({ vendorId: branch.vendorId }).lean();
  if (vendor && vendor.userId === uid) return true;
  // Optionally: admin claim
  return false;
}

function validateBusinessRules(payload) {
  const errs = [];
  if (!isNonEmptyString(payload.nameEnglish)) errs.push("nameEnglish is required");
  if (!isNonEmptyString(payload.nameArabic))  errs.push("nameArabic is required");

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
    if (payload.fixedPrice && Number(payload.fixedPrice) > 0) {
      errs.push("fixedPrice must be 0 when isSizedBased=true");
    }
  } else {
    if (!isPositive(Number(payload.fixedPrice))) {
      errs.push("fixedPrice must be > 0 when isSizedBased=false");
    }
    if (payload.offeredPrice != null) {
      const op = Number(payload.offeredPrice);
      if (isNaN(op) || op < 0) errs.push("offeredPrice must be >= 0");
      if (isPositive(Number(payload.fixedPrice)) && op > Number(payload.fixedPrice)) {
        errs.push("offeredPrice cannot be greater than fixedPrice");
      }
    }
  }

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

async function refreshSectionActiveCount(branch, sectionKey) {
  try {
    const activeCount = await MenuItem.countDocuments({
      branchId: branch.branchId,
      sectionKey,
      isActive: true
    });
    const i = (branch.menuSections || []).findIndex((s) => s.key === sectionKey);
    if (i >= 0) {
      branch.menuSections[i].itemCount = activeCount;
      await branch.save();
    }
  } catch (e) {
    console.warn("itemCount update failed:", e.message);
  }
}

// ---------------- CREATE (body-based) ----------------
export const createMenuItem = async (req, res) => {
  try {
    // Body-based identifiers (no URL params)
    const branchId = String(req.body.branchId || "").trim();
    const sectionKey = toUpper(req.body.sectionKey || "");

    if (!branchId)  return res.status(400).json({ code: "BRANCH_ID_REQUIRED", message: "branchId is required" });
    if (!sectionKey) return res.status(400).json({ code: "SECTION_KEY_REQUIRED", message: "sectionKey is required" });

    const branch = await Branch.findOne({ branchId }).lean(false);
    if (!branch) return res.status(404).json({ code: "BRANCH_NOT_FOUND", message: "Branch not found" });
    if (!(await userOwnsBranch(req, branch))) {
      return res.status(403).json({ code: "FORBIDDEN", message: "You do not own this branch" });
    }

    // Optional: if client sends vendorId, enforce match
    if (req.body.vendorId && String(req.body.vendorId) !== branch.vendorId) {
      return res.status(400).json({
        code: "VENDOR_MISMATCH",
        message: "vendorId in body does not match branch.vendorId"
      });
    }

    // Section must exist & be enabled
    const sec = (branch.menuSections || []).find((s) => s.key === sectionKey);
    if (!sec || sec.isEnabled !== true) {
      return res.status(400).json({
        code: "SECTION_NOT_ENABLED",
        message: `Menu section '${sectionKey}' is not enabled on branch ${branchId}`,
        details: { enabledSections: (branch.menuSections || []).filter(s => s.isEnabled).map(s => s.key) }
      });
    }

    const payload = {
      branchId,
      vendorId: branch.vendorId,
      sectionKey,

      itemType: req.body.itemType,
      nameEnglish: req.body.nameEnglish,
      nameArabic:  req.body.nameArabic,
      description: req.body.description ?? "",

      imageUrl: req.body.imageUrl ?? "",
      videoUrl: req.body.videoUrl ?? "",

      allergens: Array.isArray(req.body.allergens) ? req.body.allergens : [],
      tags:      Array.isArray(req.body.tags)      ? req.body.tags      : [],

      isFeatured:  !!req.body.isFeatured,
      isActive:     req.body.isActive     !== false,
      isAvailable:  req.body.isAvailable  !== false,
      isSpicy:      !!req.body.isSpicy,

      calories: req.body.calories ?? 0,
      sku:      req.body.sku ?? "",
      preparationTimeInMinutes: req.body.preparationTimeInMinutes ?? 0,

      ingredients: Array.isArray(req.body.ingredients) ? req.body.ingredients : [],
      addons:      Array.isArray(req.body.addons)      ? req.body.addons      : [],

      discount: req.body.discount || null,

      isSizedBased: !!req.body.isSizedBased,
      sizes:        Array.isArray(req.body.sizes) ? req.body.sizes : [],

      fixedPrice:   Number(req.body.fixedPrice ?? 0),
      offeredPrice: req.body.offeredPrice != null ? Number(req.body.offeredPrice) : null,

      sortOrder: Number(req.body.sortOrder ?? 0),
    };

    const errors = validateBusinessRules(payload);
    if (errors.length) {
      return res.status(400).json({ code: "VALIDATION_FAILED", message: "Invalid payload", errors });
    }

    const item = await MenuItem.create(payload);
    await refreshSectionActiveCount(branch, sectionKey);

    return res.status(201).json({ message: "Menu item created", item });
  } catch (err) {
    console.error("createMenuItem error:", err);
    return res.status(500).json({ code: "SERVER_ERROR", message: err.message });
  }
};

// ---------------- LIST (with filters) ----------------
export const listMenuItems = async (req, res) => {
  try {
    // Prefer query for GET; fallback to body if someone calls with POST in future.
    const branchId = String(req.query.branchId ?? req.body?.branchId ?? "").trim();
    const sectionKey = toUpper(req.query.sectionKey ?? req.body?.sectionKey ?? "");
    const isActive = req.query.isActive;

    if (!branchId) return res.status(400).json({ code: "BRANCH_ID_REQUIRED", message: "branchId is required" });

    const branch = await Branch.findOne({ branchId }).lean();
    if (!branch) return res.status(404).json({ code: "BRANCH_NOT_FOUND", message: "Branch not found" });
    if (!(await userOwnsBranch(req, branch))) {
      return res.status(403).json({ code: "FORBIDDEN", message: "You do not own this branch" });
    }

    const filter = { branchId };
    if (sectionKey) filter.sectionKey = sectionKey;
    if (isActive === "true")  filter.isActive = true;
    if (isActive === "false") filter.isActive = false;

    const page  = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10), 1), 100);
    const skip  = (page - 1) * limit;

    const [items, total] = await Promise.all([
      MenuItem.find(filter).sort({ sortOrder: 1, createdAt: -1 }).skip(skip).limit(limit).lean(),
      MenuItem.countDocuments(filter),
    ]);

    return res.json({
      branchId,
      sectionKey: sectionKey || undefined,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      items,
    });
  } catch (err) {
    console.error("listMenuItems error:", err);
    return res.status(500).json({ code: "SERVER_ERROR", message: err.message });
  }
};

// ---------------- GET ONE ----------------
export const getMenuItem = async (req, res) => {
  try {
    const id = req.params.id;
    const item = await MenuItem.findById(id).lean();
    if (!item) return res.status(404).json({ code: "NOT_FOUND", message: "Item not found" });

    const branch = await Branch.findOne({ branchId: item.branchId }).lean();
    if (!branch) return res.status(404).json({ code: "BRANCH_NOT_FOUND", message: "Branch not found" });

    if (!(await userOwnsBranch(req, branch))) {
      return res.status(403).json({ code: "FORBIDDEN", message: "You do not own this branch" });
    }

    return res.json({ item });
  } catch (err) {
    console.error("getMenuItem error:", err);
    return res.status(500).json({ code: "SERVER_ERROR", message: err.message });
  }
};

// ---------------- UPDATE ----------------
export const updateMenuItem = async (req, res) => {
  try {
    const id = req.params.id;
    const item = await MenuItem.findById(id);
    if (!item) return res.status(404).json({ code: "NOT_FOUND", message: "Item not found" });

    const branch = await Branch.findOne({ branchId: item.branchId }).lean(false);
    if (!branch) return res.status(404).json({ code: "BRANCH_NOT_FOUND", message: "Branch not found" });
    if (!(await userOwnsBranch(req, branch))) {
      return res.status(403).json({ code: "FORBIDDEN", message: "You do not own this branch" });
    }

    // Section change?
    let newSectionKey = req.body.sectionKey ? toUpper(req.body.sectionKey) : item.sectionKey;
    if (newSectionKey !== item.sectionKey) {
      const sec = (branch.menuSections || []).find((s) => s.key === newSectionKey);
      if (!sec || sec.isEnabled !== true) {
        return res.status(400).json({
          code: "SECTION_NOT_ENABLED",
          message: `Menu section '${newSectionKey}' is not enabled on branch ${branch.branchId}`,
        });
      }
    }

    // Build next state (partial allowed)
    const next = {
      itemType: req.body.itemType ?? item.itemType,
      nameEnglish: req.body.nameEnglish ?? item.nameEnglish,
      nameArabic:  req.body.nameArabic  ?? item.nameArabic,
      description: req.body.description ?? item.description,

      imageUrl: req.body.imageUrl ?? item.imageUrl,
      videoUrl: req.body.videoUrl ?? item.videoUrl,

      allergens: Array.isArray(req.body.allergens) ? req.body.allergens : item.allergens,
      tags:      Array.isArray(req.body.tags)      ? req.body.tags      : item.tags,

      isFeatured:  req.body.isFeatured  ?? item.isFeatured,
      isActive:    req.body.isActive    ?? item.isActive,
      isAvailable: req.body.isAvailable ?? item.isAvailable,
      isSpicy:     req.body.isSpicy     ?? item.isSpicy,

      calories: req.body.calories ?? item.calories,
      sku:      req.body.sku ?? item.sku,
      preparationTimeInMinutes: req.body.preparationTimeInMinutes ?? item.preparationTimeInMinutes,

      ingredients: Array.isArray(req.body.ingredients) ? req.body.ingredients : item.ingredients,
      addons:      Array.isArray(req.body.addons)      ? req.body.addons      : item.addons,

      discount: req.body.discount !== undefined ? req.body.discount : item.discount,

      isSizedBased: req.body.isSizedBased ?? item.isSizedBased,
      sizes:        Array.isArray(req.body.sizes) ? req.body.sizes : item.sizes,

      fixedPrice:   req.body.fixedPrice   != null ? Number(req.body.fixedPrice)   : item.fixedPrice,
      offeredPrice: req.body.offeredPrice != null ? Number(req.body.offeredPrice) : item.offeredPrice,

      sortOrder: req.body.sortOrder != null ? Number(req.body.sortOrder) : item.sortOrder,
      sectionKey: newSectionKey,
    };

    const errors = validateBusinessRules(next);
    if (errors.length) {
      return res.status(400).json({ code: "VALIDATION_FAILED", message: "Invalid payload", errors });
    }

    const prevSection = item.sectionKey;
    const prevActive  = item.isActive;

    Object.assign(item, next);
    await item.save();

    // refresh counts if section changed or active flag changed
    await refreshSectionActiveCount(branch, prevSection);
    if (newSectionKey !== prevSection || prevActive !== item.isActive) {
      await refreshSectionActiveCount(branch, newSectionKey);
    }

    return res.json({ message: "Menu item updated", item });
  } catch (err) {
    console.error("updateMenuItem error:", err);
    return res.status(500).json({ code: "SERVER_ERROR", message: err.message });
  }
};

// ---------------- DELETE ----------------
export const deleteMenuItem = async (req, res) => {
  try {
    const id = req.params.id;
    const item = await MenuItem.findById(id);
    if (!item) return res.status(404).json({ code: "NOT_FOUND", message: "Item not found" });

    const branch = await Branch.findOne({ branchId: item.branchId }).lean(false);
    if (!branch) return res.status(404).json({ code: "BRANCH_NOT_FOUND", message: "Branch not found" });
    if (!(await userOwnsBranch(req, branch))) {
      return res.status(403).json({ code: "FORBIDDEN", message: "You do not own this branch" });
    }

    const sectionKey = item.sectionKey;
    await item.deleteOne();

    await refreshSectionActiveCount(branch, sectionKey);

    return res.json({ message: "Menu item deleted", id });
  } catch (err) {
    console.error("deleteMenuItem error:", err);
    return res.status(500).json({ code: "SERVER_ERROR", message: err.message });
  }
};
