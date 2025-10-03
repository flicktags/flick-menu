// controllers/lookupController.js
import Lookup from "../models/Lookup.js";
import Allergen from "../models/Allergen.js"; // <— uses your separate model
// controllers/lookupController.js (ADD THESE)
import FoodCategoryGroup from "../models/FoodCategoryGroup.js";
import FoodCategory from "../models/FoodCategory.js";

import { generateVenueTypeCode } from "../utils/generateVenueTypeCode.js";

/* =========================
   VENUE TYPES (existing)
   ========================= */

// @desc Save a new VenueType lookup
// @route POST /api/lookups/venue-types
// @access Private (admin use ideally)
export const createVenueType = async (req, res) => {
  try {
    const { nameEnglish, nameArabic } = req.body;

    if (!nameEnglish) {
      return res.status(400).json({ message: "English name is required" });
    }

    // Auto-generate code
    const code = await generateVenueTypeCode();

    const lookup = await Lookup.create({
      type: "venueType",
      code,
      nameEnglish,
      nameArabic,
    });

    res.status(201).json({ message: "Venue type created", lookup });
  } catch (error) {
    console.error("Create VenueType Error:", error);
    res.status(500).json({ message: error.message });
  }
};

// @desc Get all VenueTypes
// @route GET /api/lookups/venue-types
// @access Public
export const getVenueTypes = async (req, res) => {
  try {
    const lookups = await Lookup.find({ type: "venueType", isActive: true });
    res.status(200).json(lookups);
  } catch (error) {
    console.error("Get VenueTypes Error:", error);
    res.status(500).json({ message: error.message });
  }
};

// @desc Update a VenueType lookup
// @route PUT /api/lookups/venue-types/:id
// @access Private (admin)
export const updateVenueType = async (req, res) => {
  try {
    const { id } = req.params;
    const { nameEnglish, nameArabic, isActive } = req.body;

    const lookup = await Lookup.findById(id);
    if (!lookup) {
      return res.status(404).json({ message: "Venue type not found" });
    }

    // Update fields if provided (code is NOT editable)
    if (nameEnglish !== undefined) lookup.nameEnglish = nameEnglish;
    if (nameArabic !== undefined) lookup.nameArabic = nameArabic;
    if (isActive !== undefined) lookup.isActive = isActive;

    await lookup.save();

    res.status(200).json({ message: "Venue type updated", lookup });
  } catch (error) {
    console.error("Update VenueType Error:", error);
    res.status(500).json({ message: error.message });
  }
};

/* =========================
   ALLERGENS (new)
   ========================= */

// @desc Create allergen
// @route POST /api/lookups/allergens
// @access Private (recommend protect with verifyFirebaseToken)
export const createAllergen = async (req, res) => {
  try {
    const { key, label, icon = null, isActive = true } = req.body || {};

    if (!key || !label?.en || !label?.ar) {
      return res
        .status(400)
        .json({ message: "key, label.en and label.ar are required" });
    }

    const doc = await Allergen.create({
      key: String(key).toLowerCase().trim(),
      label: {
        en: String(label.en).trim(),
        ar: String(label.ar).trim(),
      },
      icon,
      isActive: Boolean(isActive),
    });

    res.status(201).json({ message: "Allergen created", lookup: doc });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: "Allergen key already exists" });
    }
    console.error("Create Allergen Error:", error);
    res.status(500).json({ message: error.message });
  }
};

// @desc Get allergens (with optional q, active)
// @route GET /api/lookups/allergens
// @access Public
export const getAllergens = async (req, res) => {
  try {
    const { q, active } = req.query;

    const filter = {};
    if (typeof active !== "undefined") {
      filter.isActive = String(active).toLowerCase() === "true";
    }
    if (q && q.trim()) {
      const rx = new RegExp(q.trim(), "i");
      filter.$or = [{ key: rx }, { "label.en": rx }, { "label.ar": rx }];
    }

    const docs = await Allergen.find(filter).sort({ "label.en": 1 }).lean();
    res.status(200).json(docs);
  } catch (error) {
    console.error("Get Allergens Error:", error);
    res.status(500).json({ message: error.message });
  }
};

// @desc Get single allergen by id
// @route GET /api/lookups/allergens/:id
// @access Public
export const getAllergenById = async (req, res) => {
  try {
    const doc = await Allergen.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ message: "Not found" });
    res.status(200).json(doc);
  } catch (error) {
    console.error("Get Allergen By ID Error:", error);
    res.status(400).json({ message: "Invalid ID" });
  }
};

// @desc Get single allergen by key
// @route GET /api/lookups/allergens/by-key/:key
// @access Public
export const getAllergenByKey = async (req, res) => {
  try {
    const key = String(req.params.key).toLowerCase().trim();
    const doc = await Allergen.findOne({ key }).lean();
    if (!doc) return res.status(404).json({ message: "Not found" });
    res.status(200).json(doc);
  } catch (error) {
    console.error("Get Allergen By Key Error:", error);
    res.status(500).json({ message: error.message });
  }
};

// @desc Update allergen (key immutable)
// @route PUT /api/lookups/allergens/:id
// @access Private (admin)
export const updateAllergen = async (req, res) => {
  try {
    const { id } = req.params;
    const { label, icon, isActive } = req.body || {};

    const doc = await Allergen.findById(id);
    if (!doc) return res.status(404).json({ message: "Allergen not found" });

    // Do NOT allow changing key to keep references stable
    if (label?.en !== undefined) doc.label.en = String(label.en).trim();
    if (label?.ar !== undefined) doc.label.ar = String(label.ar).trim();
    if (icon !== undefined) doc.icon = icon ?? null;
    if (isActive !== undefined) doc.isActive = Boolean(isActive);

    await doc.save();
    res.status(200).json({ message: "Allergen updated", lookup: doc });
  } catch (error) {
    console.error("Update Allergen Error:", error);
    res.status(500).json({ message: error.message });
  }
};

/* =========================
   FOOD CATEGORY GROUPS
   ========================= */

// @desc Create a food category group
// @route POST /api/lookups/food-category-groups
// @access Private (admin)
export const createFoodCategoryGroup = async (req, res) => {
  try {
    const { code, name, nameArabic, order = 0, isActive } = req.body || {};
    if (!name || !nameArabic) {
      return res.status(400).json({ message: "name and nameArabic are required" });
    }

    const finalCode = (code && String(code).trim())
      ? String(code).trim().toUpperCase()
      : String(name).trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 24);

    const exists = await FoodCategoryGroup.findOne({ code: finalCode }).lean();
    if (exists) return res.status(409).json({ message: "Group code already exists", code: finalCode });

    const group = await FoodCategoryGroup.create({
      code: finalCode,
      name,
      nameArabic,
      order,
      isActive: isActive ?? true,
    });

    return res.status(201).json({ message: "Food category group created", group });
  } catch (error) {
    console.error("Create FoodCategoryGroup Error:", error);
    return res.status(500).json({ message: error.message });
  }
};

// @desc List food category groups
// @route GET /api/lookups/food-category-groups?activeOnly=true
// @access Public
export const getFoodCategoryGroups = async (req, res) => {
  try {
    const activeOnly = String(req.query.activeOnly ?? "true").toLowerCase() === "true";
    const filter = activeOnly ? { isActive: true } : {};
    const groups = await FoodCategoryGroup.find(filter).sort({ order: 1, name: 1 }).lean();
    return res.status(200).json(groups);
  } catch (error) {
    console.error("Get FoodCategoryGroups Error:", error);
    return res.status(500).json({ message: error.message });
  }
};

/* =========================
   FOOD CATEGORIES (BULK)
   ========================= */

// @desc Bulk create food categories
// @route POST /api/lookups/food-categories/bulk
// @access Private (admin)
// Body accepts either an array or { items: [...] }
export const bulkCreateFoodCategories = async (req, res) => {
  try {
    const items = Array.isArray(req.body) ? req.body : (Array.isArray(req.body?.items) ? req.body.items : []);
    if (!items.length) return res.status(400).json({ message: "items array is required" });

    const created = [];
    const skipped = [];
    const errors = [];

    // cache lookups
    const groupByCode = new Map();
    const groupById = new Map();

    for (const raw of items) {
      try {
        const { groupCode, groupId, code, name, nameArabic, icon = null, order = 0, isActive } = raw || {};
        if (!name || !nameArabic) {
          errors.push({ input: raw, message: "name and nameArabic are required" });
          continue;
        }
        if (!groupCode && !groupId) {
          errors.push({ input: raw, message: "groupCode or groupId is required" });
          continue;
        }

        // resolve group
        let groupDoc = null;
        if (groupId) {
          if (groupById.has(groupId)) groupDoc = groupById.get(groupId);
          else {
            groupDoc = await FoodCategoryGroup.findById(groupId).lean();
            if (groupDoc) groupById.set(groupId, groupDoc);
          }
        } else if (groupCode) {
          const key = String(groupCode).toUpperCase();
          if (groupByCode.has(key)) groupDoc = groupByCode.get(key);
          else {
            groupDoc = await FoodCategoryGroup.findOne({ code: key }).lean();
            if (groupDoc) groupByCode.set(key, groupDoc);
          }
        }
        if (!groupDoc || !groupDoc.isActive) {
          errors.push({ input: raw, message: "Invalid or inactive category group" });
          continue;
        }

        const finalCode = (code && String(code).trim())
          ? String(code).trim().toUpperCase()
          : String(name).trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 24);

        const exists = await FoodCategory.findOne({ code: finalCode }).lean();
        if (exists) {
          skipped.push({ input: raw, reason: "code already exists" });
          continue;
        }

        const doc = await FoodCategory.create({
          group: groupDoc._id,
          code: finalCode,
          name,
          nameArabic,
          icon,
          order,
          isActive: isActive ?? true,
        });

        created.push(doc);
      } catch (inner) {
        errors.push({ input: raw, message: inner.message });
      }
    }

    return res.status(201).json({
      message: "Food categories processed",
      counts: { created: created.length, skipped: skipped.length, errors: errors.length },
      created,
      skipped,
      errors,
    });
  } catch (error) {
    console.error("BulkCreate FoodCategory Error:", error);
    return res.status(500).json({ message: error.message });
  }
};

// @desc List food categories (optionally by group)
// @route GET /api/lookups/food-categories?groupCode=MAIN&groupId=&activeOnly=true
// @access Public
export const getFoodCategories = async (req, res) => {
  try {
    const { groupCode, groupId } = req.query;
    const activeOnly = String(req.query.activeOnly ?? "true").toLowerCase() === "true";

    const filter = {};
    if (activeOnly) filter.isActive = true;

    if (groupId) {
      filter.group = groupId;
    } else if (groupCode) {
      const group = await FoodCategoryGroup.findOne({ code: String(groupCode).toUpperCase() }).lean();
      if (!group) return res.status(404).json({ message: "Group not found" });
      filter.group = group._id;
    }

    const cats = await FoodCategory.find(filter)
      .populate("group", "code name nameArabic")
      .sort({ order: 1, name: 1 })
      .lean();

    return res.status(200).json(cats);
  } catch (error) {
    console.error("Get FoodCategories Error:", error);
    return res.status(500).json({ message: error.message });
  }
};
