// src/controllers/orderStatusLookupController.js
import OrderStatusLookup from "../models/OrderStatusLookupModel.js";

// helper
function cleanString(v) {
  return String(v ?? "").trim();
}

export const createOrderStatusLookup = async (req, res) => {
  try {
    const {
      code,
      nameEnglish,
      nameArabic,
      sortOrder = 0,
      isEnabled = true,
      isTerminal = false,
      colorHex = null,
    } = req.body || {};

    const c = cleanString(code).toUpperCase();
    const en = cleanString(nameEnglish);
    const ar = cleanString(nameArabic);

    if (!c) return res.status(400).json({ error: "Missing code" });
    if (!en) return res.status(400).json({ error: "Missing nameEnglish" });
    if (!ar) return res.status(400).json({ error: "Missing nameArabic" });

    const exists = await OrderStatusLookup.findOne({ code: c }).lean();
    if (exists) {
      return res.status(409).json({ error: `Status code already exists: ${c}` });
    }

    const created = await OrderStatusLookup.create({
      code: c,
      nameEnglish: en,
      nameArabic: ar,
      sortOrder: Number(sortOrder) || 0,
      isEnabled: !!isEnabled,
      isTerminal: !!isTerminal,
      colorHex: colorHex ? cleanString(colorHex) : null,
    });

    return res.status(201).json({
      message: "Order status created",
      item: {
        id: String(created._id),
        code: created.code,
        nameEnglish: created.nameEnglish,
        nameArabic: created.nameArabic,
        sortOrder: created.sortOrder,
        isEnabled: created.isEnabled,
        isTerminal: created.isTerminal,
        colorHex: created.colorHex,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      },
    });
  } catch (err) {
    // unique code collision
    if (err && err.code === 11000) {
      return res.status(409).json({ error: "Duplicate status code" });
    }
    console.error("createOrderStatusLookup error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};

export const updateOrderStatusLookup = async (req, res) => {
  try {
    const { id } = req.params;

    const patch = req.body || {};
    const update = {};

    if (patch.code !== undefined) {
      const c = cleanString(patch.code).toUpperCase();
      if (!c) return res.status(400).json({ error: "code cannot be empty" });
      update.code = c;
    }
    if (patch.nameEnglish !== undefined) {
      const en = cleanString(patch.nameEnglish);
      if (!en) return res.status(400).json({ error: "nameEnglish cannot be empty" });
      update.nameEnglish = en;
    }
    if (patch.nameArabic !== undefined) {
      const ar = cleanString(patch.nameArabic);
      if (!ar) return res.status(400).json({ error: "nameArabic cannot be empty" });
      update.nameArabic = ar;
    }
    if (patch.sortOrder !== undefined) update.sortOrder = Number(patch.sortOrder) || 0;
    if (patch.isEnabled !== undefined) update.isEnabled = !!patch.isEnabled;
    if (patch.isTerminal !== undefined) update.isTerminal = !!patch.isTerminal;
    if (patch.colorHex !== undefined) update.colorHex = patch.colorHex ? cleanString(patch.colorHex) : null;

    const updated = await OrderStatusLookup.findByIdAndUpdate(
      id,
      { $set: update },
      { new: true }
    );

    if (!updated) return res.status(404).json({ error: "Status not found" });

    return res.status(200).json({
      message: "Order status updated",
      item: {
        id: String(updated._id),
        code: updated.code,
        nameEnglish: updated.nameEnglish,
        nameArabic: updated.nameArabic,
        sortOrder: updated.sortOrder,
        isEnabled: updated.isEnabled,
        isTerminal: updated.isTerminal,
        colorHex: updated.colorHex,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ error: "Duplicate status code" });
    }
    console.error("updateOrderStatusLookup error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};

export const getOrderStatusLookups = async (req, res) => {
  try {
    const enabledOnly = (req.query.enabledOnly || "").toString().trim() === "1";
    const sort = (req.query.sort || "sortOrder").toString().trim(); // sortOrder|code|newest

    const q = {};
    if (enabledOnly) q.isEnabled = true;

    let sortSpec = { sortOrder: 1, code: 1 };
    if (sort === "code") sortSpec = { code: 1 };
    if (sort === "newest") sortSpec = { createdAt: -1 };

    const items = await OrderStatusLookup.find(q).sort(sortSpec).lean();

    return res.status(200).json({
      count: items.length,
      items: items.map((s) => ({
        id: String(s._id),
        code: s.code,
        nameEnglish: s.nameEnglish,
        nameArabic: s.nameArabic,
        sortOrder: s.sortOrder ?? 0,
        isEnabled: s.isEnabled === true,
        isTerminal: s.isTerminal === true,
        colorHex: s.colorHex ?? null,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
    });
  } catch (err) {
    console.error("getOrderStatusLookups error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};

export const getOrderStatusLookupById = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await OrderStatusLookup.findById(id).lean();
    if (!item) return res.status(404).json({ error: "Status not found" });

    return res.status(200).json({
      item: {
        id: String(item._id),
        code: item.code,
        nameEnglish: item.nameEnglish,
        nameArabic: item.nameArabic,
        sortOrder: item.sortOrder ?? 0,
        isEnabled: item.isEnabled === true,
        isTerminal: item.isTerminal === true,
        colorHex: item.colorHex ?? null,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      },
    });
  } catch (err) {
    console.error("getOrderStatusLookupById error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};

export const deleteOrderStatusLookup = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await OrderStatusLookup.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ error: "Status not found" });

    return res.status(200).json({
      message: "Order status deleted",
      id: String(id),
    });
  } catch (err) {
    console.error("deleteOrderStatusLookup error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};
