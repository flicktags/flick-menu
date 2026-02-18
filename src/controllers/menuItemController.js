// controllers/menuItemController.js
import MenuItem from "../models/MenuItem.js";
import Branch from "../models/Branch.js";
import Vendor from "../models/Vendor.js";
import cloudinary, { CLOUDINARY_FOLDER } from "../utils/cloudinary.js";

import { touchBranchMenuStampByBizId } from "../utils/touchMenuStamp.js";

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
  if (!isNonEmptyString(payload.nameEnglish))
    errs.push("nameEnglish is required");
  if (!isNonEmptyString(payload.nameArabic))
    errs.push("nameArabic is required");

  // Price model
  if (payload.isSizedBased === true) {
    if (!Array.isArray(payload.sizes) || payload.sizes.length === 0) {
      errs.push("sizes must be a non-empty array when isSizedBased=true");
    } else {
      for (const s of payload.sizes) {
        if (!isNonEmptyString(s.label))
          errs.push("each size.label is required");
        if (!isPositive(Number(s.price)))
          errs.push("each size.price must be > 0");
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
      if (
        isPositive(Number(payload.fixedPrice)) &&
        op > Number(payload.fixedPrice)
      ) {
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
      if (isNaN(d.getTime()))
        errs.push("discount.validUntil must be a valid ISO date");
    }
  }
  const avErrs = validateAvailability(payload.availability);
  if (avErrs.length) errs.push(...avErrs);

  if (payload.calories != null) {
    const cals = Number(payload.calories);
    if (isNaN(cals) || cals < 0) errs.push("calories must be >= 0");
  }
  if (payload.preparationTimeInMinutes != null) {
    const mins = Number(payload.preparationTimeInMinutes);
    if (isNaN(mins) || mins < 0)
      errs.push("preparationTimeInMinutes must be >= 0");
  }
  return errs;
}

async function refreshSectionActiveCount(branch, sectionKey) {
  try {
    const activeCount = await MenuItem.countDocuments({
      branchId: branch.branchId,
      sectionKey,
      isActive: true,
    });
    const i = (branch.menuSections || []).findIndex(
      (s) => s.key === sectionKey,
    );
    if (i >= 0) {
      branch.menuSections[i].itemCount = activeCount;
      await branch.save();
    }
  } catch (e) {
    console.warn("itemCount update failed:", e.message);
  }
}

function isOurCloudinaryUrl(url) {
  if (!url || typeof url !== "string") return false;
  return url.includes("res.cloudinary.com/");
}

function publicIdFromCloudinaryUrl(url) {
  if (!url || typeof url !== "string") return null;

  const marker = "/upload/";
  const i = url.indexOf(marker);
  if (i === -1) return null;

  let rest = url.substring(i + marker.length);
  rest = rest.split("?")[0];

  const parts = rest.split("/").filter(Boolean);

  // find v12345 segment (transformations may exist before it)
  const vIndex = parts.findIndex((p) => /^v\d+$/.test(p));
  const startIndex = vIndex !== -1 ? vIndex + 1 : 0;

  const publicParts = parts.slice(startIndex);
  if (!publicParts.length) return null;

  let publicId = publicParts.join("/");
  publicId = publicId.replace(/\.[a-zA-Z0-9]+$/, ""); // remove extension

  return publicId || null;
}

function isInAllowedFolder(publicId) {
  if (!CLOUDINARY_FOLDER || !CLOUDINARY_FOLDER.trim()) return true;
  const f = CLOUDINARY_FOLDER.trim().replace(/\/+$/, ""); // remove trailing slash
  return publicId === f || publicId.startsWith(`${f}/`);
}

const isHHmm = (s) =>
  typeof s === "string" && /^([01]\d|2[0-3]):([0-5]\d)$/.test(s.trim());

function sanitizeAvailability(raw) {
  if (!raw || typeof raw !== "object") return undefined;

  const enabled = raw.enabled === true;

  // if disabled, keep it minimal (or store undefined if you prefer)
  if (!enabled) {
    return { enabled: false };
  }

  const type =
    String(raw.type || "FIXED")
      .trim()
      .toUpperCase() === "PER_DAY"
      ? "PER_DAY"
      : "FIXED";

  const timezone =
    typeof raw.timezone === "string" && raw.timezone.trim()
      ? raw.timezone.trim()
      : "Asia/Bahrain";

  const cleanWindow = (w) => {
    if (!w || typeof w !== "object") return null;
    const start = String(w.start || "").trim();
    const end = String(w.end || "").trim();
    if (!isHHmm(start) || !isHHmm(end)) return null;
    return { start, end };
  };

  if (type === "FIXED") {
    const fixed = raw.fixed || {};
    const start = String(fixed.start || "").trim();
    const end = String(fixed.end || "").trim();

    // allow enabled but empty -> vendor can fill later? (I recommend NOT allowing)
    // We'll validate strictly in validateBusinessRules below.
    return { enabled: true, type, timezone, fixed: { start, end } };
  }

  // PER_DAY
  const perDay = raw.perDay && typeof raw.perDay === "object" ? raw.perDay : {};
  const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const out = {};
  for (const d of days) {
    const arr = Array.isArray(perDay[d]) ? perDay[d] : [];
    out[d] = arr.map(cleanWindow).filter(Boolean);
  }
  return { enabled: true, type, timezone, perDay: out };
}

function validateAvailability(av) {
  const errs = [];
  if (!av) return errs;
  if (av.enabled !== true) return errs;

  if (!["FIXED", "PER_DAY"].includes(av.type)) {
    errs.push("availability.type must be FIXED or PER_DAY");
    return errs;
  }

  if (av.type === "FIXED") {
    const start = av.fixed?.start;
    const end = av.fixed?.end;
    if (!isHHmm(start)) errs.push("availability.fixed.start must be HH:mm");
    if (!isHHmm(end)) errs.push("availability.fixed.end must be HH:mm");
    return errs;
  }

  // PER_DAY
  const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  for (const d of days) {
    const windows = av.perDay?.[d] ?? [];
    if (!Array.isArray(windows)) {
      errs.push(`availability.perDay.${d} must be an array`);
      continue;
    }
    for (const w of windows) {
      if (!isHHmm(w.start))
        errs.push(`availability.perDay.${d}.start must be HH:mm`);
      if (!isHHmm(w.end))
        errs.push(`availability.perDay.${d}.end must be HH:mm`);
    }
  }
  return errs;
}

// ---------------- CREATE (body-based) ----------------

/** small coercion helpers */
const asStr = (v, def = "") => (v == null ? def : String(v));
const asUpper = (v, def = "") => asStr(v, def).trim().toUpperCase();
const asBool = (v, def = false) => (typeof v === "boolean" ? v : !!v);
const asNum = (v, def = 0) => {
  if (v === "" || v === null || v === undefined) return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
/** use undefined (not null) for optional fields with validators */
const asOptionalNumber = (v) => {
  if (v === "" || v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const asArrayOfStrings = (v) =>
  Array.isArray(v) ? v.map((x) => String(x)) : [];

export const createMenuItem = async (req, res) => {
  try {
    const branchId = asStr(req.body.branchId).trim();
    const sectionKey = asUpper(req.body.sectionKey);

    if (!branchId) {
      return res.status(400).json({
        code: "BRANCH_ID_REQUIRED",
        message: "branchId is required",
      });
    }
    if (!sectionKey) {
      return res.status(400).json({
        code: "SECTION_KEY_REQUIRED",
        message: "sectionKey is required",
      });
    }

    const branch = await Branch.findOne({ branchId }).lean(false);
    if (!branch) {
      return res.status(404).json({
        code: "BRANCH_NOT_FOUND",
        message: "Branch not found",
      });
    }

    if (!(await userOwnsBranch(req, branch))) {
      return res.status(403).json({
        code: "FORBIDDEN",
        message: "You do not own this branch",
      });
    }

    if (req.body.vendorId && String(req.body.vendorId) !== branch.vendorId) {
      return res.status(400).json({
        code: "VENDOR_MISMATCH",
        message: "vendorId in body does not match branch.vendorId",
      });
    }

    const sec = (branch.menuSections || []).find((s) => s.key === sectionKey);
    if (!sec || sec.isEnabled !== true) {
      return res.status(400).json({
        code: "SECTION_NOT_ENABLED",
        message: `Menu section '${sectionKey}' is not enabled on branch ${branchId}`,
        details: {
          enabledSections: (branch.menuSections || [])
            .filter((s) => s.isEnabled)
            .map((s) => s.key),
        },
      });
    }

    // ======================================================
    // ✅ KDS Station (Option A)
    // - Missing => MAIN
    // - Present but invalid/disabled => 400
    // ======================================================
    const rawStationKey = String(req.body.kdsStationKey ?? "").trim();
    const normalizedStationKey = rawStationKey
      ? rawStationKey.toUpperCase()
      : "";

    const stations = Array.isArray(branch.stations) ? branch.stations : [];

    // If not provided, default MAIN (but still validate MAIN exists & enabled if you want)
    const finalStationKey = normalizedStationKey || "MAIN";

    const stationExistsAndEnabled = stations.some((s) => {
      const key = String(s?.key ?? "")
        .trim()
        .toUpperCase();
      const enabled = s?.isEnabled !== false; // treat missing as enabled
      return key === finalStationKey && enabled;
    });

    // Option A enforcement:
    // if user provided a key, it MUST exist & be enabled.
    // if user did not provide key, MAIN is used. You may still enforce MAIN exists if you want.
    if (normalizedStationKey) {
      if (!stationExistsAndEnabled) {
        return res.status(400).json({
          code: "INVALID_STATION_KEY",
          message: `Invalid or disabled kdsStationKey '${finalStationKey}' for branch ${branchId}`,
          details: {
            provided: normalizedStationKey,
            allowed: stations
              .filter((s) => s?.isEnabled !== false)
              .map((s) =>
                String(s?.key ?? "")
                  .trim()
                  .toUpperCase(),
              )
              .filter(Boolean),
          },
        });
      }
    } else {
      // If you want to strictly enforce MAIN exists & enabled too, keep this check:
      // If you prefer always allowing MAIN even if stations list is empty, remove this block.
      if (!stationExistsAndEnabled) {
        return res.status(400).json({
          code: "MAIN_STATION_MISSING",
          message: `Default station MAIN is missing or disabled for branch ${branchId}`,
        });
      }
    }

    // Build payload with safe coercions
    const payload = {
      branchId,
      vendorId: branch.vendorId,
      sectionKey,

      itemType: asStr(req.body.itemType).trim(),
      nameEnglish: asStr(req.body.nameEnglish).trim(),
      nameArabic: asStr(req.body.nameArabic).trim(),
      description: asStr(req.body.description, ""),
      descriptionArabic: asStr(req.body.descriptionArabic, ""),

      imageUrl: asStr(req.body.imageUrl, ""),
      imagePublicId: asStr(req.body.imagePublicId, "").trim(),
      videoUrl: asStr(req.body.videoUrl, ""),

      allergens: asArrayOfStrings(req.body.allergens),
      tags: asArrayOfStrings(req.body.tags),

      isFeatured: asBool(req.body.isFeatured, false),
      isActive: req.body.isActive !== false,
      isAvailable: req.body.isAvailable !== false,
      isSpicy: asBool(req.body.isSpicy, false),
      availability: sanitizeAvailability(req.body.availability),

      calories: asNum(req.body.calories, 0),
      sku: asStr(req.body.sku, "").trim(),
      preparationTimeInMinutes: asNum(req.body.preparationTimeInMinutes, 10),

      ingredients: asArrayOfStrings(req.body.ingredients),
      addons: Array.isArray(req.body.addons) ? req.body.addons : [],

      discount:
        req.body.discount && typeof req.body.discount === "object"
          ? req.body.discount
          : undefined,

      isSizedBased: asBool(req.body.isSizedBased, false),
      sizes: Array.isArray(req.body.sizes) ? req.body.sizes : [],

      fixedPrice: asNum(req.body.fixedPrice, 0),
      offeredPrice: asOptionalNumber(req.body.offeredPrice),

      sortOrder: asNum(req.body.sortOrder, 0),

      // ---------- Group-level category ----------
      foodCategoryGroupId: req.body.foodCategoryGroupId
        ? String(req.body.foodCategoryGroupId)
        : null,
      foodCategoryGroupCode: asUpper(req.body.foodCategoryGroupCode, ""),
      foodCategoryGroupNameEnglish: asStr(
        req.body.foodCategoryGroupNameEnglish,
        "",
      ).trim(),

      // ✅ IMPORTANT: add this (this was missing)
      kdsStationKey: finalStationKey,
    };

    console.log(
      "[createMenuItem] kdsStationKey raw=",
      rawStationKey,
      "final=",
      finalStationKey,
    );
    console.log("[createMenuItem] payload:", JSON.stringify(payload));

    const errors = validateBusinessRules ? validateBusinessRules(payload) : [];
    if (errors.length) {
      return res.status(400).json({
        code: "VALIDATION_FAILED",
        message: "Invalid payload",
        errors,
      });
    }

    const item = await MenuItem.create(payload);

    await touchBranchMenuStampByBizId(branchId);

    return res.status(201).json({ message: "Menu item created", item });
  } catch (err) {
    console.error("createMenuItem error:", err);
    return res.status(500).json({
      code: "SERVER_ERROR",
      message: err?.message || "Unexpected error",
      details: err?.errors
        ? Object.keys(err.errors).reduce((o, k) => {
            o[k] = err.errors[k]?.message;
            return o;
          }, {})
        : undefined,
      name: err?.name,
      kind: err?.kind,
      path: err?.path,
      value: err?.value,
    });
  }
};

// export const createMenuItem = async (req, res) => {
//   try {
//     const branchId = asStr(req.body.branchId).trim();
//     const sectionKey = asUpper(req.body.sectionKey);

//     if (!branchId) return res.status(400).json({ code: "BRANCH_ID_REQUIRED", message: "branchId is required" });
//     if (!sectionKey) return res.status(400).json({ code: "SECTION_KEY_REQUIRED", message: "sectionKey is required" });

//     const branch = await Branch.findOne({ branchId }).lean(false);
//     if (!branch) return res.status(404).json({ code: "BRANCH_NOT_FOUND", message: "Branch not found" });

//     if (!(await userOwnsBranch(req, branch))) {
//       return res.status(403).json({ code: "FORBIDDEN", message: "You do not own this branch" });
//     }

//     if (req.body.vendorId && String(req.body.vendorId) !== branch.vendorId) {
//       return res.status(400).json({
//         code: "VENDOR_MISMATCH",
//         message: "vendorId in body does not match branch.vendorId",
//       });
//     }

//     const sec = (branch.menuSections || []).find((s) => s.key === sectionKey);
//     if (!sec || sec.isEnabled !== true) {
//       return res.status(400).json({
//         code: "SECTION_NOT_ENABLED",
//         message: `Menu section '${sectionKey}' is not enabled on branch ${branchId}`,
//         details: { enabledSections: (branch.menuSections || []).filter((s) => s.isEnabled).map((s) => s.key) },
//       });
//     }

//     // Build payload with safe coercions
//     const payload = {
//       branchId,
//       vendorId: branch.vendorId,
//       sectionKey,

//       itemType: asStr(req.body.itemType).trim(),
//       nameEnglish: asStr(req.body.nameEnglish).trim(),
//       nameArabic: asStr(req.body.nameArabic).trim(),
//       description: asStr(req.body.description, ""),
//       descriptionArabic: asStr(req.body.descriptionArabic, ""),

//       imageUrl: asStr(req.body.imageUrl, ""),
//       imagePublicId: asStr(req.body.imagePublicId, "").trim(), // ✅ NEW (optional)
//       videoUrl: asStr(req.body.videoUrl, ""),

//       allergens: asArrayOfStrings(req.body.allergens),
//       tags: asArrayOfStrings(req.body.tags),

//       isFeatured: asBool(req.body.isFeatured, false),
//       isActive: req.body.isActive !== false,
//       isAvailable: req.body.isAvailable !== false,
//       isSpicy: asBool(req.body.isSpicy, false),

//       calories: asNum(req.body.calories, 0),
//       sku: asStr(req.body.sku, "").trim(),
//       preparationTimeInMinutes: asNum(req.body.preparationTimeInMinutes, 10),

//       ingredients: asArrayOfStrings(req.body.ingredients),
//       addons: Array.isArray(req.body.addons) ? req.body.addons : [],

//       // IMPORTANT: undefined (not null) when not present
//       discount:
//         req.body.discount && typeof req.body.discount === "object" ? req.body.discount : undefined,

//       isSizedBased: asBool(req.body.isSizedBased, false),
//       sizes: Array.isArray(req.body.sizes) ? req.body.sizes : [],

//       fixedPrice: asNum(req.body.fixedPrice, 0),
//       offeredPrice: asOptionalNumber(req.body.offeredPrice),

//       sortOrder: asNum(req.body.sortOrder, 0),

//       // ---------- NEW FIELDS (Group-level category) ----------
//       foodCategoryGroupId:
//         req.body.foodCategoryGroupId ? String(req.body.foodCategoryGroupId) : null,
//       foodCategoryGroupCode: asUpper(req.body.foodCategoryGroupCode, ""),
//       foodCategoryGroupNameEnglish: asStr(req.body.foodCategoryGroupNameEnglish, "").trim(),
//       // -------------------------------------------------------
//     };

//     // Log payload once for debugging (remove if noisy)
//     console.log("[createMenuItem] payload:", JSON.stringify(payload));

//     // Business rules check (keep this if you have it)
//     const errors = validateBusinessRules ? validateBusinessRules(payload) : [];
//     if (errors.length) {
//       return res.status(400).json({
//         code: "VALIDATION_FAILED",
//         message: "Invalid payload",
//         errors,
//       });
//     }

//     const item = await MenuItem.create(payload);

//     await touchBranchMenuStampByBizId(branchId);

//     // Optional: refresh section stats if you have this util
//     // await refreshSectionActiveCount(branch, sectionKey);

//     return res.status(201).json({ message: "Menu item created", item });
//   } catch (err) {
//     console.error("createMenuItem error:", err);
//     // Bubble up Mongoose validation/cast details to help debugging
//     return res.status(500).json({
//       code: "SERVER_ERROR",
//       message: err?.message || "Unexpected error",
//       details: err?.errors ? Object.keys(err.errors).reduce((o, k) => {
//         o[k] = err.errors[k]?.message;
//         return o;
//       }, {}) : undefined,
//       name: err?.name,
//       kind: err?.kind,
//       path: err?.path,
//       value: err?.value
//     });
//   }
// };

// ---------------- LIST (no pagination) ----------------
export const listMenuItems = async (req, res) => {
  try {
    const branchId = String(
      req.query.branchId ?? req.body?.branchId ?? "",
    ).trim();
    const sectionKey = toUpper(
      req.query.sectionKey ?? req.body?.sectionKey ?? "",
    );
    const isActive = req.query.isActive;

    if (!branchId)
      return res
        .status(400)
        .json({ code: "BRANCH_ID_REQUIRED", message: "branchId is required" });

    const branch = await Branch.findOne({ branchId }).lean();
    if (!branch)
      return res
        .status(404)
        .json({ code: "BRANCH_NOT_FOUND", message: "Branch not found" });
    if (!(await userOwnsBranch(req, branch))) {
      return res
        .status(403)
        .json({ code: "FORBIDDEN", message: "You do not own this branch" });
    }

    const filter = { branchId };
    if (sectionKey) filter.sectionKey = sectionKey;
    if (isActive === "true") filter.isActive = true;
    if (isActive === "false") filter.isActive = false;

    // Return ALL matching items (no page/limit)
    const items = await MenuItem.find(filter)
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean();

    return res.json({
      branchId,
      sectionKey: sectionKey || undefined,
      total: items.length,
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
    if (!item)
      return res
        .status(404)
        .json({ code: "NOT_FOUND", message: "Item not found" });

    const branch = await Branch.findOne({ branchId: item.branchId }).lean();
    if (!branch)
      return res
        .status(404)
        .json({ code: "BRANCH_NOT_FOUND", message: "Branch not found" });

    if (!(await userOwnsBranch(req, branch))) {
      return res
        .status(403)
        .json({ code: "FORBIDDEN", message: "You do not own this branch" });
    }

    return res.json({ item });
  } catch (err) {
    console.error("getMenuItem error:", err);
    return res.status(500).json({ code: "SERVER_ERROR", message: err.message });
  }
};

// // ---------------- UPDATE ----------------
// export const updateMenuItem = async (req, res) => {
//   try {
//     const id = (req.params.id || "").trim();
//     if (!id) {
//       return res.status(400).json({ code: "ID_REQUIRED", message: "Item id is required" });
//     }

//     const item = await MenuItem.findById(id);
//     if (!item) return res.status(404).json({ code: "NOT_FOUND", message: "Item not found" });

//     const branch = await Branch.findOne({ branchId: item.branchId }).lean(false);
//     if (!branch) return res.status(404).json({ code: "BRANCH_NOT_FOUND", message: "Branch not found" });
//     if (!(await userOwnsBranch(req, branch))) {
//       return res.status(403).json({ code: "FORBIDDEN", message: "You do not own this branch" });
//     }

//     // ---- helpers (same semantics as create) ----
//     const asStr = (v, def = "") => (v == null ? def : String(v));
//     const asUpper = (v, def = "") => asStr(v, def).trim().toUpperCase();
//     const asBool = (v, def = false) =>
//       typeof v === "boolean" ? v : v == null ? def : !!v;
//     const asNum = (v, def = 0) => {
//       if (v === "" || v === null || v === undefined) return def;
//       const n = Number(v);
//       return Number.isFinite(n) ? n : def;
//     };

//     // Section move validation (if any)
//     const newSectionKey = req.body.sectionKey ? asUpper(req.body.sectionKey) : item.sectionKey;
//     if (newSectionKey !== item.sectionKey) {
//       const sec = (branch.menuSections || []).find((s) => s.key === newSectionKey);
//       if (!sec || sec.isEnabled !== true) {
//         return res.status(400).json({
//           code: "SECTION_NOT_ENABLED",
//           message: `Menu section '${newSectionKey}' is not enabled on branch ${branch.branchId}`,
//         });
//       }
//     }

//     // Build "next" state using PATCH semantics.
//     // If a field is omitted in body, keep existing.
//     const next = {
//       itemType: req.body.itemType != null ? asStr(req.body.itemType).trim() : item.itemType,
//       nameEnglish: req.body.nameEnglish != null ? asStr(req.body.nameEnglish).trim() : item.nameEnglish,
//       nameArabic:  req.body.nameArabic  != null ? asStr(req.body.nameArabic).trim()  : item.nameArabic,
//       description: req.body.description != null ? asStr(req.body.description, "") : item.description,
//       descriptionArabic: req.body.descriptionArabic != null ? asStr(req.body.descriptionArabic, "") : item.descriptionArabic,

//       imageUrl: req.body.imageUrl != null ? asStr(req.body.imageUrl, "") : item.imageUrl,
//       imagePublicId: Object.prototype.hasOwnProperty.call(req.body, "imagePublicId")
//         ? asStr(req.body.imagePublicId, "").trim()
//         : item.imagePublicId,
//       videoUrl: req.body.videoUrl != null ? asStr(req.body.videoUrl, "") : item.videoUrl,

//       allergens: Array.isArray(req.body.allergens) ? req.body.allergens.map(String) : item.allergens,
//       tags:      Array.isArray(req.body.tags)      ? req.body.tags.map(String)      : item.tags,

//       isFeatured:  req.body.isFeatured  != null ? asBool(req.body.isFeatured, item.isFeatured)     : item.isFeatured,
//       isActive:    req.body.isActive    != null ? asBool(req.body.isActive, item.isActive)         : item.isActive,
//       isAvailable: req.body.isAvailable != null ? asBool(req.body.isAvailable, item.isAvailable)   : item.isAvailable,
//       isSpicy:     req.body.isSpicy     != null ? asBool(req.body.isSpicy, item.isSpicy)           : item.isSpicy,

//       calories: req.body.calories != null ? asNum(req.body.calories, item.calories) : item.calories,
//       sku:      req.body.sku      != null ? asStr(req.body.sku, "").trim()          : item.sku,
//       preparationTimeInMinutes:
//                 req.body.preparationTimeInMinutes != null
//                   ? asNum(req.body.preparationTimeInMinutes, item.preparationTimeInMinutes)
//                   : item.preparationTimeInMinutes,

//       ingredients: Array.isArray(req.body.ingredients) ? req.body.ingredients.map(String) : item.ingredients,
//       addons:      Array.isArray(req.body.addons)      ? req.body.addons                   : item.addons,

//       // discount PATCH rules:
//       // - omit => keep existing
//       // - null  => remove (set undefined)
//       // - object => replace
//       discount:
//         Object.prototype.hasOwnProperty.call(req.body, "discount")
//           ? (req.body.discount === null
//               ? undefined
//               : (typeof req.body.discount === "object" ? req.body.discount : item.discount))
//           : item.discount,

//       isSizedBased: req.body.isSizedBased != null ? asBool(req.body.isSizedBased, item.isSizedBased) : item.isSizedBased,
//       sizes:        Array.isArray(req.body.sizes) ? req.body.sizes : item.sizes,

//       fixedPrice:   req.body.fixedPrice   != null ? asNum(req.body.fixedPrice, item.fixedPrice)       : item.fixedPrice,

//       // offeredPrice PATCH rules (align with schema: undefined when "removed"):
//       // - omit => keep existing
//       // - "" or null => undefined (remove)
//       // - number/string => set Number
//       offeredPrice: Object.prototype.hasOwnProperty.call(req.body, "offeredPrice")
//         ? ((req.body.offeredPrice === "" || req.body.offeredPrice === null)
//             ? undefined
//             : Number(req.body.offeredPrice))
//         : item.offeredPrice,

//       sortOrder: req.body.sortOrder != null ? asNum(req.body.sortOrder, item.sortOrder) : item.sortOrder,

//       sectionKey: newSectionKey,
//     };

//     // ---------- NEW: Group-level category fields ----------
//     // Only update when explicitly present in body (so PATCH doesn't unintentionally blank them)
//     if (Object.prototype.hasOwnProperty.call(req.body, "foodCategoryGroupId")) {
//       next.foodCategoryGroupId =
//         req.body.foodCategoryGroupId ? String(req.body.foodCategoryGroupId) : null;
//     } else {
//       next.foodCategoryGroupId = item.foodCategoryGroupId;
//     }

//     if (Object.prototype.hasOwnProperty.call(req.body, "foodCategoryGroupCode")) {
//       next.foodCategoryGroupCode = asUpper(req.body.foodCategoryGroupCode, "");
//     } else {
//       next.foodCategoryGroupCode = item.foodCategoryGroupCode;
//     }

//     if (Object.prototype.hasOwnProperty.call(req.body, "foodCategoryGroupNameEnglish")) {
//       next.foodCategoryGroupNameEnglish = asStr(req.body.foodCategoryGroupNameEnglish, "").trim();
//     } else {
//       next.foodCategoryGroupNameEnglish = item.foodCategoryGroupNameEnglish;
//     }
//     // ------------------------------------------------------

//     // Validate business rules (same checker you already use)
//     const errors = validateBusinessRules(next);
//     if (errors.length) {
//       return res.status(400).json({ code: "VALIDATION_FAILED", message: "Invalid payload", errors });
//     }

//     const prevSection = item.sectionKey;
//     const prevActive  = item.isActive;

//     Object.assign(item, next);
//     await item.save();

//     await refreshSectionActiveCount(branch, prevSection);
//     if (newSectionKey !== prevSection || prevActive !== item.isActive) {
//       await refreshSectionActiveCount(branch, newSectionKey);
//     }
//     await touchBranchMenuStampByBizId(branch.branchId);

//     return res.json({ message: "Menu item updated", item });
//   } catch (err) {
//     console.error("updateMenuItem error:", err);
//     return res.status(500).json({
//       code: "SERVER_ERROR",
//       message: err?.message || "Unexpected error",
//       details: err?.errors ? Object.keys(err.errors).reduce((o, k) => {
//         o[k] = err.errors[k]?.message;
//         return o;
//       }, {}) : undefined,
//     });
//   }
// };

// ---------------- UPDATE ----------------
export const updateMenuItem = async (req, res) => {
  try {
    const id = (req.params.id || "").trim();
    if (!id) {
      return res
        .status(400)
        .json({ code: "ID_REQUIRED", message: "Item id is required" });
    }

    const item = await MenuItem.findById(id);
    if (!item) {
      return res
        .status(404)
        .json({ code: "NOT_FOUND", message: "Item not found" });
    }

    const branch = await Branch.findOne({ branchId: item.branchId }).lean(
      false,
    );
    if (!branch) {
      return res
        .status(404)
        .json({ code: "BRANCH_NOT_FOUND", message: "Branch not found" });
    }

    if (!(await userOwnsBranch(req, branch))) {
      return res
        .status(403)
        .json({ code: "FORBIDDEN", message: "You do not own this branch" });
    }

    // ---- helpers (same semantics as create) ----
    const asStr = (v, def = "") => (v == null ? def : String(v));
    const asUpper = (v, def = "") => asStr(v, def).trim().toUpperCase();
    const asBool = (v, def = false) =>
      typeof v === "boolean" ? v : v == null ? def : !!v;
    const asNum = (v, def = 0) => {
      if (v === "" || v === null || v === undefined) return def;
      const n = Number(v);
      return Number.isFinite(n) ? n : def;
    };

    // =========================
    // Image change detection
    // =========================
    const hasImagePublicIdInBody = Object.prototype.hasOwnProperty.call(
      req.body,
      "imagePublicId",
    );

    const oldPublicId = asStr(item.imagePublicId, "").trim();
    const incomingPublicId = hasImagePublicIdInBody
      ? asStr(req.body.imagePublicId, "").trim()
      : null;

    const imageAction =
      hasImagePublicIdInBody && incomingPublicId === ""
        ? "remove"
        : hasImagePublicIdInBody &&
            incomingPublicId &&
            incomingPublicId !== oldPublicId
          ? "replace"
          : "none";

    // =========================
    // Section move validation (if any)
    // =========================
    const newSectionKey = req.body.sectionKey
      ? asUpper(req.body.sectionKey)
      : item.sectionKey;

    if (newSectionKey !== item.sectionKey) {
      const sec = (branch.menuSections || []).find(
        (s) => s.key === newSectionKey,
      );
      if (!sec || sec.isEnabled !== true) {
        return res.status(400).json({
          code: "SECTION_NOT_ENABLED",
          message: `Menu section '${newSectionKey}' is not enabled on branch ${branch.branchId}`,
        });
      }
    }

    // ======================================================
    // ✅ KDS Station (Option A) for PATCH
    // - If kdsStationKey key is NOT present => keep existing
    // - If present => validate against branch.stations enabled list
    // ======================================================
    const hasStationKeyInBody = Object.prototype.hasOwnProperty.call(
      req.body,
      "kdsStationKey",
    );

    const stations = Array.isArray(branch.stations) ? branch.stations : [];

    const allowedStationKeys = stations
      .filter((s) => s?.isEnabled !== false)
      .map((s) =>
        String(s?.key ?? "")
          .trim()
          .toUpperCase(),
      )
      .filter(Boolean);

    const currentStationKey = String(item.kdsStationKey ?? "MAIN")
      .trim()
      .toUpperCase();

    let finalStationKey = currentStationKey;

    if (hasStationKeyInBody) {
      const raw = String(req.body.kdsStationKey ?? "").trim();
      const normalized = raw ? raw.toUpperCase() : "";

      // If they explicitly sent empty -> treat as missing -> fallback MAIN
      const candidate = normalized || "MAIN";

      const ok = allowedStationKeys.includes(candidate);

      if (!ok) {
        return res.status(400).json({
          code: "INVALID_STATION_KEY",
          message: `Invalid or disabled kdsStationKey '${candidate}' for branch ${branch.branchId}`,
          details: {
            provided: raw,
            normalized: candidate,
            allowed: allowedStationKeys,
          },
        });
      }

      finalStationKey = candidate;
    }

    const hasAvailabilityInBody = Object.prototype.hasOwnProperty.call(
      req.body,
      "availability",
    );
    // PATCH semantics:
    // - omit => keep existing
    // - null => remove (undefined)
    // - object => sanitize & set
    let nextAvailability = item.availability;
    if (hasAvailabilityInBody) {
      if (req.body.availability === null) {
        nextAvailability = undefined;
      } else {
        nextAvailability = sanitizeAvailability(req.body.availability);
      }
    }
    // =========================
    // Build "next" state using PATCH semantics.
    // =========================
    const next = {
      itemType:
        req.body.itemType != null
          ? asStr(req.body.itemType).trim()
          : item.itemType,
      nameEnglish:
        req.body.nameEnglish != null
          ? asStr(req.body.nameEnglish).trim()
          : item.nameEnglish,
      nameArabic:
        req.body.nameArabic != null
          ? asStr(req.body.nameArabic).trim()
          : item.nameArabic,
      description:
        req.body.description != null
          ? asStr(req.body.description, "")
          : item.description,
      descriptionArabic:
        req.body.descriptionArabic != null
          ? asStr(req.body.descriptionArabic, "")
          : item.descriptionArabic,

      // ✅ Image fields (unchanged)
      imageUrl:
        req.body.imageUrl != null
          ? asStr(req.body.imageUrl, "")
          : item.imageUrl,
      imagePublicId: hasImagePublicIdInBody
        ? asStr(req.body.imagePublicId, "").trim()
        : item.imagePublicId,

      videoUrl:
        req.body.videoUrl != null
          ? asStr(req.body.videoUrl, "")
          : item.videoUrl,

      allergens: Array.isArray(req.body.allergens)
        ? req.body.allergens.map(String)
        : item.allergens,
      tags: Array.isArray(req.body.tags)
        ? req.body.tags.map(String)
        : item.tags,

      isFeatured:
        req.body.isFeatured != null
          ? asBool(req.body.isFeatured, item.isFeatured)
          : item.isFeatured,
      isActive:
        req.body.isActive != null
          ? asBool(req.body.isActive, item.isActive)
          : item.isActive,
      isAvailable:
        req.body.isAvailable != null
          ? asBool(req.body.isAvailable, item.isAvailable)
          : item.isAvailable,
      isSpicy:
        req.body.isSpicy != null
          ? asBool(req.body.isSpicy, item.isSpicy)
          : item.isSpicy,
      availability: nextAvailability,

      calories:
        req.body.calories != null
          ? asNum(req.body.calories, item.calories)
          : item.calories,
      sku: req.body.sku != null ? asStr(req.body.sku, "").trim() : item.sku,
      preparationTimeInMinutes:
        req.body.preparationTimeInMinutes != null
          ? asNum(
              req.body.preparationTimeInMinutes,
              item.preparationTimeInMinutes,
            )
          : item.preparationTimeInMinutes,

      ingredients: Array.isArray(req.body.ingredients)
        ? req.body.ingredients.map(String)
        : item.ingredients,
      addons: Array.isArray(req.body.addons) ? req.body.addons : item.addons,

      discount: Object.prototype.hasOwnProperty.call(req.body, "discount")
        ? req.body.discount === null
          ? undefined
          : typeof req.body.discount === "object"
            ? req.body.discount
            : item.discount
        : item.discount,

      isSizedBased:
        req.body.isSizedBased != null
          ? asBool(req.body.isSizedBased, item.isSizedBased)
          : item.isSizedBased,
      sizes: Array.isArray(req.body.sizes) ? req.body.sizes : item.sizes,

      fixedPrice:
        req.body.fixedPrice != null
          ? asNum(req.body.fixedPrice, item.fixedPrice)
          : item.fixedPrice,

      offeredPrice: Object.prototype.hasOwnProperty.call(
        req.body,
        "offeredPrice",
      )
        ? req.body.offeredPrice === "" || req.body.offeredPrice === null
          ? undefined
          : Number(req.body.offeredPrice)
        : item.offeredPrice,

      sortOrder:
        req.body.sortOrder != null
          ? asNum(req.body.sortOrder, item.sortOrder)
          : item.sortOrder,

      sectionKey: newSectionKey,

      // ✅ NEW: station key (PATCH semantics applied above)
      kdsStationKey: finalStationKey,
    };

    // ✅ Remove image => clear both fields
    if (imageAction === "remove") {
      next.imagePublicId = "";
      next.imageUrl = "";
    }

    // ---------- Group-level category fields (unchanged) ----------
    if (Object.prototype.hasOwnProperty.call(req.body, "foodCategoryGroupId")) {
      next.foodCategoryGroupId = req.body.foodCategoryGroupId
        ? String(req.body.foodCategoryGroupId)
        : null;
    } else {
      next.foodCategoryGroupId = item.foodCategoryGroupId;
    }

    if (
      Object.prototype.hasOwnProperty.call(req.body, "foodCategoryGroupCode")
    ) {
      next.foodCategoryGroupCode = asUpper(req.body.foodCategoryGroupCode, "");
    } else {
      next.foodCategoryGroupCode = item.foodCategoryGroupCode;
    }

    if (
      Object.prototype.hasOwnProperty.call(
        req.body,
        "foodCategoryGroupNameEnglish",
      )
    ) {
      next.foodCategoryGroupNameEnglish = asStr(
        req.body.foodCategoryGroupNameEnglish,
        "",
      ).trim();
    } else {
      next.foodCategoryGroupNameEnglish = item.foodCategoryGroupNameEnglish;
    }
    // ------------------------------------------------------------

    console.log(
      "[updateMenuItem] station hasKey=",
      hasStationKeyInBody,
      "final=",
      next.kdsStationKey,
    );

    const errors = validateBusinessRules(next);
    if (errors.length) {
      return res.status(400).json({
        code: "VALIDATION_FAILED",
        message: "Invalid payload",
        errors,
      });
    }

    const prevSection = item.sectionKey;
    const prevActive = item.isActive;

    Object.assign(item, next);
    await item.save();

    // Cloudinary delete old on replace/remove (unchanged)
    if (oldPublicId) {
      const shouldDeleteOld =
        (imageAction === "replace" &&
          incomingPublicId &&
          incomingPublicId !== oldPublicId) ||
        imageAction === "remove";

      if (shouldDeleteOld) {
        try {
          await cloudinary.uploader.destroy(oldPublicId, {
            resource_type: "image",
          });
        } catch (e) {
          console.warn(
            "[Cloudinary] destroy failed:",
            oldPublicId,
            e?.message || e,
          );
        }
      }
    }

    await refreshSectionActiveCount(branch, prevSection);
    if (newSectionKey !== prevSection || prevActive !== item.isActive) {
      await refreshSectionActiveCount(branch, newSectionKey);
    }
    await touchBranchMenuStampByBizId(branch.branchId);

    return res.json({ message: "Menu item updated", item });
  } catch (err) {
    console.error("updateMenuItem error:", err);
    return res.status(500).json({
      code: "SERVER_ERROR",
      message: err?.message || "Unexpected error",
      details: err?.errors
        ? Object.keys(err.errors).reduce((o, k) => {
            o[k] = err.errors[k]?.message;
            return o;
          }, {})
        : undefined,
    });
  }
};
// ---------------- DELETE ----------------

export const deleteMenuItem = async (req, res) => {
  try {
    const id = req.params.id;

    const item = await MenuItem.findById(id);
    if (!item)
      return res
        .status(404)
        .json({ code: "NOT_FOUND", message: "Item not found" });

    const branch = await Branch.findOne({ branchId: item.branchId }).lean(
      false,
    );
    if (!branch)
      return res
        .status(404)
        .json({ code: "BRANCH_NOT_FOUND", message: "Branch not found" });

    if (!(await userOwnsBranch(req, branch))) {
      return res
        .status(403)
        .json({ code: "FORBIDDEN", message: "You do not own this branch" });
    }

    // ✅ delete image on Cloudinary (best-effort, don't block DB delete)
    const url = (item.imageUrl || "").trim();
    let publicId = "";

    if (url && isOurCloudinaryUrl(url)) {
      publicId = publicIdFromCloudinaryUrl(url) || "";
    }

    if (publicId && isInAllowedFolder(publicId)) {
      try {
        await cloudinary.uploader.destroy(publicId, {
          resource_type: "image",
          invalidate: true,
        });
      } catch (e) {
        console.warn(
          "[deleteMenuItem] Cloudinary destroy failed:",
          e?.message || e,
        );
      }
    } else if (publicId) {
      console.warn(
        "[deleteMenuItem] Skipped Cloudinary delete (outside allowed folder):",
        publicId,
      );
    }

    const sectionKey = item.sectionKey;

    await item.deleteOne();

    await refreshSectionActiveCount(branch, sectionKey);
    await touchBranchMenuStampByBizId(branch.branchId);

    return res.json({
      message: "Menu item deleted",
      id,
      cloudinary: publicId
        ? { attempted: true, publicId }
        : { attempted: false, reason: "no_image_or_not_cloudinary" },
    });
  } catch (err) {
    console.error("deleteMenuItem error:", err);
    return res.status(500).json({ code: "SERVER_ERROR", message: err.message });
  }
};

// export const deleteMenuItem = async (req, res) => {
//   try {
//     const id = req.params.id;
//     const item = await MenuItem.findById(id);
//     if (!item) return res.status(404).json({ code: "NOT_FOUND", message: "Item not found" });

//     const branch = await Branch.findOne({ branchId: item.branchId }).lean(false);
//     if (!branch) return res.status(404).json({ code: "BRANCH_NOT_FOUND", message: "Branch not found" });
//     if (!(await userOwnsBranch(req, branch))) {
//       return res.status(403).json({ code: "FORBIDDEN", message: "You do not own this branch" });
//     }

//     const sectionKey = item.sectionKey;
//     await item.deleteOne();

//     await refreshSectionActiveCount(branch, sectionKey);
//     await touchBranchMenuStampByBizId(branch.branchId);

//     return res.json({ message: "Menu item deleted", id });
//   } catch (err) {
//     console.error("deleteMenuItem error:", err);
//     return res.status(500).json({ code: "SERVER_ERROR", message: err.message });
//   }
// };
