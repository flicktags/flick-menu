import Branch from "../models/Branch.js";
import Vendor from "../models/Vendor.js";
import MenuItem from "../models/MenuItem.js"

/* ---------- helpers (same spirit as your branch controller) ---------- */

const loadBranchByPublicId = async (branchId) => {
  return Branch.findOne({ branchId }).lean(); // read-only is fine here
};

const ensureCanManageBranch = async (uid, branch) => {
  if (!uid || !branch) return false;
  if (branch.userId === uid) return true;
  const vendor = await Vendor.findOne({ vendorId: branch.vendorId }).lean();
  if (vendor && vendor.userId === uid) return true;
  // (optional) admin claim
  return false;
};

const bumpSectionCount = async (branchId, sectionKey, delta) => {
  // increment/decrement itemCount on the section (if present)
  await Branch.updateOne(
    { branchId, "menuSections.key": sectionKey },
    { $inc: { "menuSections.$.itemCount": delta } }
  ).catch(() => {});
};

/* ---------- CREATE: POST /api/menu/items ---------- */
export const createMenuItem = async (req, res) => {
  try {
    const uid = req.user?.uid;
    const {
      branchId,
      sectionKey,
      itemType,
      nameEnglish,
      nameArabic,
      description,
      allergens = [],
      tags = [],
      isFeatured = false,
      isActive = true,
      calories = 0,
      sku,
      isAvailable = true,
      preparationTimeInMinutes = 10,
      // Accept both "ingredient" (string) and "ingredients" (array)
      ingredient,
      ingredients,
      addons = [],
      isSpicy = false,
      discount, // {type, value, validUntil}
      isSizedBased = false,
      sizes = [],
      fixedPrice = 0,
      offeredPrice = null,
      imageUrl = "",
      videoUrl = "",
      sortOrder = 0,
    } = req.body || {};

    if (!branchId || !sectionKey || !nameEnglish || !nameArabic) {
      return res.status(400).json({ message: "branchId, sectionKey, nameEnglish, nameArabic are required" });
    }

    const branch = await loadBranchByPublicId(branchId);
    if (!branch) return res.status(404).json({ message: "Branch not found" });
    if (!(await ensureCanManageBranch(uid, branch))) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const sectionKeyUC = String(sectionKey).toUpperCase().trim();

    // Normalize ingredients
    const normalizedIngredients = Array.isArray(ingredients)
      ? ingredients
      : (ingredient ? [String(ingredient)] : []);

    const item = await MenuItem.create({
      branchId,
      vendorId: branch.vendorId,
      sectionKey: sectionKeyUC,
      sortOrder,

      itemType,
      nameEnglish,
      nameArabic,
      description,

      imageUrl,
      videoUrl,

      allergens,
      tags,

      isFeatured,
      isActive,
      isAvailable,
      isSpicy,

      calories,
      sku,
      preparationTimeInMinutes,

      ingredients: normalizedIngredients,
      addons,

      isSizedBased,
      sizes: isSizedBased ? sizes : [],
      fixedPrice: isSizedBased ? 0 : fixedPrice,
      offeredPrice: offeredPrice ?? null,

      discount, // optional
    });

    // Best effort: bump the section counter
    await bumpSectionCount(branchId, sectionKeyUC, +1);

    return res.status(201).json({ message: "Menu item created", item });
  } catch (e) {
    console.error("createMenuItem error:", e);
    return res.status(500).json({ message: e.message });
  }
};

/* ---------- LIST: GET /api/menu/items?branchId=...&sectionKey=... ---------- */
export const listMenuItems = async (req, res) => {
  try {
    const uid = req.user?.uid;
    const { branchId } = req.query;
    if (!branchId) return res.status(400).json({ message: "branchId is required" });

    const branch = await loadBranchByPublicId(branchId);
    if (!branch) return res.status(404).json({ message: "Branch not found" });
    if (!(await ensureCanManageBranch(uid, branch))) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const page  = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10), 1), 100);
    const skip  = (page - 1) * limit;

    const sectionKey = req.query.sectionKey?.trim().toUpperCase();
    const q = req.query.q?.trim();
    const onlyActive = String(req.query.onlyActive ?? "false").toLowerCase() === "true";

    const filter = { branchId };
    if (sectionKey) filter.sectionKey = sectionKey;
    if (onlyActive) filter.isActive = true;
    if (q) {
      filter.$or = [
        { nameEnglish: { $regex: q, $options: "i" } },
        { nameArabic:  { $regex: q, $options: "i" } },
        { sku:         { $regex: q, $options: "i" } },
        { tags:        { $regex: q, $options: "i" } },
      ];
    }

    const [items, total] = await Promise.all([
      MenuItem.find(filter)
        .sort({ sectionKey: 1, sortOrder: 1, nameEnglish: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      MenuItem.countDocuments(filter),
    ]);

    return res.json({
      branchId,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      items,
    });
  } catch (e) {
    console.error("listMenuItems error:", e);
    return res.status(500).json({ message: e.message });
  }
};

/* ---------- READ ONE: GET /api/menu/items/:id ---------- */
export const getMenuItem = async (req, res) => {
  try {
    const uid = req.user?.uid;
    const { id } = req.params;

    const item = await MenuItem.findById(id).lean();
    if (!item) return res.status(404).json({ message: "Item not found" });

    const branch = await loadBranchByPublicId(item.branchId);
    if (!branch) return res.status(404).json({ message: "Branch not found" });
    if (!(await ensureCanManageBranch(uid, branch))) {
      return res.status(403).json({ message: "Forbidden" });
    }

    return res.json({ item });
  } catch (e) {
    console.error("getMenuItem error:", e);
    return res.status(500).json({ message: e.message });
  }
};

/* ---------- UPDATE: PATCH /api/menu/items/:id ---------- */
export const updateMenuItem = async (req, res) => {
  try {
    const uid = req.user?.uid;
    const { id } = req.params;

    const existing = await MenuItem.findById(id);
    if (!existing) return res.status(404).json({ message: "Item not found" });

    const branch = await loadBranchByPublicId(existing.branchId);
    if (!branch) return res.status(404).json({ message: "Branch not found" });
    if (!(await ensureCanManageBranch(uid, branch))) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const payload = { ...req.body };

    // section change? keep counts in sync
    let sectionChanged = false;
    if (payload.sectionKey && String(payload.sectionKey).toUpperCase().trim() !== existing.sectionKey) {
      sectionChanged = true;
      payload.sectionKey = String(payload.sectionKey).toUpperCase().trim();
    }

    // normalize ingredients if client sends "ingredient"
    if (payload.ingredient && !payload.ingredients) {
      payload.ingredients = [String(payload.ingredient)];
      delete payload.ingredient;
    }

    // pricing normalizations
    if (payload.isSizedBased === true) {
      payload.fixedPrice = 0;
      if (!Array.isArray(payload.sizes)) payload.sizes = [];
    } else if (payload.isSizedBased === false) {
      payload.sizes = [];
    }

    const updated = await MenuItem.findByIdAndUpdate(
      id,
      { $set: payload },
      { new: true }
    ).lean();

    if (sectionChanged) {
      await Promise.all([
        bumpSectionCount(existing.branchId, existing.sectionKey, -1),
        bumpSectionCount(existing.branchId, updated.sectionKey, +1),
      ]);
    }

    return res.json({ message: "Updated", item: updated });
  } catch (e) {
    console.error("updateMenuItem error:", e);
    return res.status(500).json({ message: e.message });
  }
};

/* ---------- DELETE: DELETE /api/menu/items/:id ---------- */
export const deleteMenuItem = async (req, res) => {
  try {
    const uid = req.user?.uid;
    const { id } = req.params;

    const existing = await MenuItem.findById(id);
    if (!existing) return res.status(404).json({ message: "Item not found" });

    const branch = await loadBranchByPublicId(existing.branchId);
    if (!branch) return res.status(404).json({ message: "Branch not found" });
    if (!(await ensureCanManageBranch(uid, branch))) {
      return res.status(403).json({ message: "Forbidden" });
    }

    await MenuItem.deleteOne({ _id: id });
    await bumpSectionCount(existing.branchId, existing.sectionKey, -1);

    return res.json({ message: "Deleted", id });
  } catch (e) {
    console.error("deleteMenuItem error:", e);
    return res.status(500).json({ message: e.message });
  }
};

/* ---------- QUICK AVAILABILITY: PATCH /api/menu/items/:id/availability ---------- */
export const setAvailability = async (req, res) => {
  try {
    const uid = req.user?.uid;
    const { id } = req.params;
    const { isAvailable } = req.body;

    if (typeof isAvailable !== "boolean") {
      return res.status(400).json({ message: "isAvailable (boolean) is required" });
    }

    const existing = await MenuItem.findById(id);
    if (!existing) return res.status(404).json({ message: "Item not found" });

    const branch = await loadBranchByPublicId(existing.branchId);
    if (!branch) return res.status(404).json({ message: "Branch not found" });
    if (!(await ensureCanManageBranch(uid, branch))) {
      return res.status(403).json({ message: "Forbidden" });
    }

    existing.isAvailable = isAvailable;
    await existing.save();

    return res.json({ message: "Availability updated", id, isAvailable });
  } catch (e) {
    console.error("setAvailability error:", e);
    return res.status(500).json({ message: e.message });
  }
};
