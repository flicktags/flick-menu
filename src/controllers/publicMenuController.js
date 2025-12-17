import mongoose from "mongoose";
import Branch from "../models/Branch.js";
import MenuItem from "../models/MenuItem.js";
import Vendor from "../models/Vendor.js";
import QrCode from "../models/QrCodeOrders.js"; // ✅ for QR-aware mode
import ThemeMapping from "../models/ThemeMapping.js";

// Safely get [key, value] pairs from Map | Object | null
function entriesOf(maybeMapOrObj) {
  if (!maybeMapOrObj) return [];
  if (maybeMapOrObj instanceof Map) return Array.from(maybeMapOrObj.entries());
  if (typeof maybeMapOrObj === "object" && !Array.isArray(maybeMapOrObj)) {
    return Object.entries(maybeMapOrObj);
  }
  return [];
}

// Force codes to 01..08 and return a plain object
function normalizeItemTypeDesignMap(raw) {
  const allowed = new Set(["01","02","03","04","05","06","07","08"]);
  const out = {};
  for (const [k, v] of entriesOf(raw)) {
    const vv = String(v || "").padStart(2, "0");
    out[k] = allowed.has(vv) ? vv : "01";
  }
  return out;
}

// ✅ NEW: lightweight branch info for customer view (safe to add to all public APIs)
function buildPublicBranchInfo(branch) {
  return {
    branchId: branch?.branchId ?? null,
    vendorId: branch?.vendorId ?? null,
    nameEnglish: branch?.nameEnglish ?? null,
    nameArabic: branch?.nameArabic ?? null,
    timeZone: branch?.timeZone ?? null,
    currency: branch?.currency ?? null,
    serviceFeatures: Array.isArray(branch?.serviceFeatures) ? branch.serviceFeatures : [],
    openingHours: branch?.openingHours ?? null,
    contact: branch?.contact ?? null,
  };
}

// -----------------------------------------------------------------------------
// Meta (currency + vendor VAT + settings)
async function buildMetaForBranch(branch) {
  const currency = branch?.currency ?? null;

  let vendor = { vendorId: null, vatNumber: null, vatRate: null };
  let settings = undefined;

  if (branch?.vendorId) {
    const v = await Vendor.findOne({ vendorId: branch.vendorId })
      .select("vendorId billing.vatNumber taxes.vatPercentage settings.priceIncludesVat")
      .lean();

    if (v) {
      const vatPct =
        typeof v?.taxes?.vatPercentage === "number" ? v.taxes.vatPercentage : null;

      vendor = {
        vendorId: v.vendorId || null,
        vatNumber: v?.billing?.vatNumber ?? null,
        vatRate: vatPct !== null ? vatPct / 100 : null, // e.g. 10 -> 0.10
      };

      if (typeof v?.settings?.priceIncludesVat === "boolean") {
        settings = { priceIncludesVat: v.settings.priceIncludesVat };
      }
    }
  }
  return { currency, vendor, settings };
}

function buildMenuStamp(branch) {
  return {
    menuVersion: typeof branch?.menuVersion === "number" ? branch.menuVersion : 1,
    menuUpdatedAt: branch?.menuUpdatedAt ? new Date(branch.menuUpdatedAt).toISOString() : null,
  };
}

// -----------------------------------------------------------------------------
// Helpers for QR-aware flow (still under /api/public/*)
function isObjectId(id) {
  return mongoose.Types.ObjectId.isValid(String(id || ""));
}
function suffixOf(numStr) {
  const m = /(\d+)$/.exec(String(numStr || ""));
  return m ? parseInt(m[1], 10) : null;
}
function parseSeatFromQr({ type, number }) {
  const kind = String(type || "").toLowerCase(); // "table" | "room"
  const idx = suffixOf(number);
  return {
    kind: ["table", "room"].includes(kind) ? kind : undefined,
    index: Number.isFinite(idx) ? idx : undefined,
  };
}

/**
 * Resolve context in ONE place:
 * - If `qrId` is present, resolve via QR (premium flow). `branch` query becomes optional guard.
 * - Else, require `branch` (free-tier flow).
 * Returns: { branch, qr | undefined }
 */
async function resolveContext(req) {
  const qrId = String(req.query?.qrId || req.query?.qr || "").trim();
  const branchBizId = String(req.query?.branch || "").trim(); // optional when qrId given
  const type = String(req.query?.type || "").trim().toLowerCase(); // optional
  const number = String(req.query?.number || "").trim(); // optional

  // --- Premium (QR) path
  if (qrId) {
    const qr = await QrCode.findOne({ qrId }).lean();
    if (!qr) {
      const err = new Error("QR not found");
      err.status = 404;
      throw err;
    }
    if (qr.active === false) {
      const err = new Error("QR is inactive");
      err.status = 410; // Gone
      throw err;
    }

    // load branch via QR's stored Mongo _id (or fallback to branch= guard)
    let branch = null;
    if (isObjectId(qr.branchId)) {
      branch = await Branch.findById(qr.branchId).lean();
    }
    if (!branch && branchBizId) {
      branch = await Branch.findOne({ branchId: branchBizId }).lean();
    }
    if (!branch) {
      const err = new Error("Branch not found for QR");
      err.status = 404;
      throw err;
    }

    // integrity (only if provided in query)
    if (branchBizId && branch.branchId !== branchBizId) {
      const err = new Error("branch mismatch between QR and request");
      err.status = 409;
      throw err;
    }
    if (qr.vendorId && branch.vendorId && qr.vendorId !== branch.vendorId) {
      const err = new Error("vendor mismatch between QR and branch");
      err.status = 409;
      throw err;
    }
    if (type && String(qr.type || "").toLowerCase() !== type) {
      const err = new Error("type mismatch for QR");
      err.status = 409;
      throw err;
    }
    if (number && String(qr.number || "") !== number) {
      const err = new Error("number mismatch for QR");
      err.status = 409;
      throw err;
    }

    const seat = parseSeatFromQr({ type: qr.type, number: qr.number });
    const qrPublic = {
      qrId: qr.qrId,
      type: qr.type,              // "table" | "room"
      number: qr.number,          // e.g., "table-12"
      label: qr.label ?? undefined,
      active: qr.active !== false,
      vendorId: qr.vendorId ?? undefined,
      branchObjectId: String(qr.branchId || ""),
      branchId: branch.branchId,  // business id (BR-xxxxx)
      seat,                       // { kind, index }
    };

    return { branch, qr: qrPublic };
  }

  // --- Free-tier (explicit branch) path
  if (!branchBizId) {
    const err = new Error("branch is required (business id)");
    err.status = 400;
    throw err;
  }
  const branch = await Branch.findOne({ branchId: branchBizId }).lean();
  if (!branch) {
    const err = new Error("Branch not found");
    err.status = 404;
    throw err;
  }
  return { branch, qr: undefined };
}

// =====================================================================
// PUBLIC ENDPOINTS (unchanged URLs) + optional QR support
// base: /api/public/*
// =====================================================================

// ---------------------------------------------------------------------
// GET /api/public/menu/sections?branch=BR-000005
// ALSO works with: /api/public/menu/sections?qrId=QR-000138
// export const getPublicMenuTypes = async (req, res) => {
//   try {
//     const { branch, qr } = await resolveContext(req);

//     const sections = (branch.menuSections || [])
//       .filter((s) => s.isEnabled === true)
//       .map((s) => ({
//         key: s.key,
//         nameEnglish: s.nameEnglish,
//         nameArabic: s.nameArabic,
//         itemCount: s.itemCount ?? undefined,
//         icon: s.icon ?? undefined,
//       }));

//     const meta = await buildMetaForBranch(branch);

//     const resp = {
//       branchId: branch.branchId,
//       // ✅ NEW: branch operational info in SAME response
//       branch: buildPublicBranchInfo(branch),
//       sections,
//       ...meta,
//       menuStamp: buildMenuStamp(branch), // ✅ NEW
//       serverTime: new Date().toISOString(),
//     };
//     if (qr) resp.qr = qr; // include seat info only when QR is used
//     return res.json(resp);
//   } catch (err) {
//     const status = err.status || 500;
//     return res.status(status).json({ message: err.message || "Failed to load sections" });
//   }
// };


// GET /api/public/menu/sections?branch=BR-000005
// Optional: ?stampOnly=1  -> returns only menuStamp + serverTime
export const getPublicMenuTypes = async (req, res) => {
  try {
    const { branch, qr } = await resolveContext(req);

    // ✅ NEW: stampOnly mode (very light payload)
    const stampOnly = String(req.query?.stampOnly || "").trim() === "1";
    if (stampOnly) {
      const resp = {
        branchId: branch.branchId,
        menuStamp: buildMenuStamp(branch),
        serverTime: new Date().toISOString(),
      };
      if (qr) resp.qr = qr;
      return res.json(resp);
    }

    const sections = (branch.menuSections || [])
      .filter((s) => s.isEnabled === true)
      .map((s) => ({
        key: s.key,
        nameEnglish: s.nameEnglish,
        nameArabic: s.nameArabic,
        itemCount: s.itemCount ?? undefined,
        icon: s.icon ?? undefined,
      }));

    const meta = await buildMetaForBranch(branch);

    const resp = {
      branchId: branch.branchId,
      branch: {
        branchId: branch.branchId,
        vendorId: branch.vendorId,
        nameEnglish: branch.nameEnglish,
        nameArabic: branch.nameArabic,
        timeZone: branch.timeZone,
        currency: branch.currency,
        serviceFeatures: branch.serviceFeatures || [],
        openingHours: branch.openingHours || {},
        contact: branch.contact || {},
         // ✅ NEW
        branding: {
          logo: branch.branding?.logo ?? null,
          coverBannerLogo: branch.branding?.coverBannerLogo ?? null,
          splashScreenEnabled: branch.branding?.splashScreenEnabled === true,
        },
      },
      sections,
      ...meta,
      menuStamp: buildMenuStamp(branch),
      serverTime: new Date().toISOString(),
    };

    if (qr) resp.qr = qr;
    return res.json(resp);
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ message: err.message || "Failed to load sections" });
  }
};

// ---------------------------------------------------------------------
// GET /api/public/menu?branch=BR-000005
// ALSO works with: /api/public/menu?qrId=QR-000138
export const getPublicMenu = async (req, res) => {
  try {
    const { branch, qr } = await resolveContext(req);

    const meta = await buildMetaForBranch(branch);

    const resp = {
      branch: {
        branchId: branch.branchId,
        vendorId: branch.vendorId,
        nameEnglish: branch.nameEnglish,
        nameArabic: branch.nameArabic,
        currency: branch.currency,
        taxes: branch.taxes,
        branding: branch.branding,
        menuSections: branch.menuSections,

        // ✅ NEW
        serviceFeatures: branch.serviceFeatures ?? [],
        openingHours: branch.openingHours ?? null,
        contact: branch.contact ?? null,
        timeZone: branch.timeZone ?? null,
      },
      ...meta,
      menuStamp: buildMenuStamp(branch), // ✅ NEW
      serverTime: new Date().toISOString(),
    };

    // ✅ also keep a consistent lightweight branch object everywhere (future-proof)
    resp.branchLite = buildPublicBranchInfo(branch);

    if (qr) resp.qr = qr;
    return res.status(200).json(resp);
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ message: err.message || "Failed to load menu" });
  }
};

// ---------------------------------------------------------------------
// GET /api/public/menu/items?branch=...&sectionKey=...&page=&limit=
// ALSO works with: /api/public/menu/items?qrId=QR-000138&sectionKey=...&page=&limit=
export const getPublicSectionItems = async (req, res) => {
  try {
    const sectionKey = String(req.query?.sectionKey || "").trim();
    if (!sectionKey) {
      return res.status(400).json({ message: "sectionKey is required" });
    }

    const page = Math.max(1, parseInt(String(req.query?.page || "1"), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query?.limit || "20"), 10)));
    const skip = (page - 1) * limit;

    const { branch, qr } = await resolveContext(req);

    const query = {
      branchId: branch.branchId, // business id
      sectionKey,
      isActive: true,
      isAvailable: true,
    };

    const total = await MenuItem.countDocuments(query);
    const items = await MenuItem.find(query)
      .sort({ sortOrder: 1, nameEnglish: 1 })
      .skip(skip)
      .limit(limit)
      .select(
        "_id branchId vendorId sectionKey sortOrder itemType " +
          "nameEnglish nameArabic description descriptionArabic imageUrl videoUrl " +
          "allergens tags isFeatured isActive isAvailable isSpicy " +
          "calories sku preparationTimeInMinutes ingredients addons " +
          "isSizedBased sizes fixedPrice offeredPrice discount createdAt updatedAt"
      )
      .lean();

    const meta = await buildMetaForBranch(branch);

    const resp = {
      branchId: branch.branchId,
      branch: buildPublicBranchInfo(branch), // ✅ NEW
      sectionKey,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      ...meta,
      menuStamp: buildMenuStamp(branch), // ✅ NEW
      items,
    };
    if (qr) resp.qr = qr;
    return res.status(200).json(resp);
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ message: err.message || "Failed to load items" });
  }
};

// ---------------------------------------------------------------------
// GET /api/public/menu/section-grouped?branch=...&sectionKey=...&limit=
// ALSO works with: /api/public/menu/section-grouped?qrId=QR-000138&sectionKey=...&limit=
export const getPublicSectionItemsGrouped = async (req, res) => {
  try {
    const sectionKey = String(req.query?.sectionKey || "").trim();
    if (!sectionKey) {
      return res.status(400).json({ message: "sectionKey is required" });
    }

    const hardCap = Math.min(1000, Math.max(1, parseInt(String(req.query?.limit || "1000"), 10)));

    const { branch, qr } = await resolveContext(req);

    const query = { branchId: branch.branchId, sectionKey, isActive: true, isAvailable: true };

    const items = await MenuItem.find(query)
      .sort({ sortOrder: 1, nameEnglish: 1 })
      .limit(hardCap)
      .lean();

    // Group by itemType (fallback to "UNCATEGORIZED")
    const map = new Map();
    for (const it of items) {
      const key = (it.itemType && String(it.itemType).trim()) || "UNCATEGORIZED";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(it);
    }

    const groups = Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([itemType, list]) => ({
        itemType,
        count: list.length,
        items: list,
      }));

    const meta = await buildMetaForBranch(branch);

    const resp = {
      branchId: branch.branchId,
      branch: buildPublicBranchInfo(branch), // ✅ NEW
      sectionKey,
      totalItems: items.length,
      ...meta,
      menuStamp: buildMenuStamp(branch), // ✅ NEW
      groups,
    };
    if (qr) resp.qr = qr;
    return res.json(resp);
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ message: err.message || "Failed to load grouped items" });
  }
};

// ---------------------------------------------------------------------
// GET /api/public/menu/catalog?branch=...&maxPerSection=
// ALSO works with: /api/public/menu/catalog?qrId=QR-000138&maxPerSection=
export const getPublicBranchCatalog = async (req, res) => {
  try {
    const maxPerSection = Math.min(
      2000,
      Math.max(1, parseInt(String(req.query?.maxPerSection || "1000"), 10))
    );

    const { branch, qr } = await resolveContext(req);

    const enabledSections = (branch.menuSections || []).filter((s) => s.isEnabled === true);

    const sections = await Promise.all(
      enabledSections.map(async (s) => {
        const items = await MenuItem.find({
          branchId: branch.branchId,
          sectionKey: s.key,
          isActive: true,
          isAvailable: true,
        })
          .sort({ sortOrder: 1, nameEnglish: 1 })
          .limit(maxPerSection)
          .lean();

        // Group by itemType
        const gmap = new Map();
        for (const it of items) {
          const key = (it.itemType && String(it.itemType).trim()) || "UNCATEGORIZED";
          if (!gmap.has(key)) gmap.set(key, []);
          gmap.get(key).push(it);
        }

        const itemTypes = Array.from(gmap.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([itemType, list]) => ({
            itemType,
            count: list.length,
            items: list,
          }));

        return {
          key: s.key,
          nameEnglish: s.nameEnglish,
          nameArabic: s.nameArabic,
          itemCount: s.itemCount ?? undefined,
          itemTypes,
        };
      })
    );

    const meta = await buildMetaForBranch(branch);

    const resp = {
      branch: {
        branchId: branch.branchId,
        nameEnglish: branch.nameEnglish,
        nameArabic: branch.nameArabic,
        currency: branch.currency ?? undefined,
        taxes: branch.taxes ?? undefined,
        branding: branch.branding ?? undefined,

        // ✅ NEW
        serviceFeatures: branch.serviceFeatures ?? [],
        openingHours: branch.openingHours ?? null,
        contact: branch.contact ?? null,
        timeZone: branch.timeZone ?? null,
      },
      // ✅ also include a consistent lightweight object (easy for customer UI)
      branchLite: buildPublicBranchInfo(branch),

      ...meta,
      menuStamp: buildMenuStamp(branch), // ✅ NEW
      sections,
      serverTime: new Date().toISOString(),
    };
    if (qr) resp.qr = qr;
    return res.json(resp);
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ message: err.message || "Failed to load catalog" });
  }
};

// ---------------------------------------------------------------------
// NEW: GET /api/public/menu/grouped-tree
export const getPublicGroupedTree = async (req, res) => {
  try {
    const { branch, qr } = await resolveContext(req);

    const sectionKey = String(req.query?.sectionKey || "").trim(); // optional
    const rawCode = String(req.query?.foodCategoryGroupCode || "").trim();
    const codeFilter = rawCode ? rawCode.toUpperCase() : null;
    const hardCap = Math.min(20000, Math.max(1, parseInt(String(req.query?.limit || "5000"), 10)));

    const query = {
      branchId: branch.branchId,
      isActive: true,
      isAvailable: true,
    };
    if (sectionKey) query.sectionKey = sectionKey;
    if (codeFilter) query.foodCategoryGroupCode = codeFilter;

    const items = await MenuItem.find(query)
      .sort({ sortOrder: 1, nameEnglish: 1 })
      .limit(hardCap)
      .select(
        "_id branchId vendorId sectionKey sortOrder itemType " +
          "nameEnglish nameArabic description descriptionArabic imageUrl videoUrl " +
          "allergens tags isFeatured isActive isAvailable isSpicy " +
          "calories sku preparationTimeInMinutes ingredients addons " +
          "isSizedBased sizes fixedPrice offeredPrice discount createdAt updatedAt " +
          "foodCategoryGroupCode foodCategoryGroupId foodCategoryGroupNameEnglish"
      )
      .lean();

    // Build: FoodCategory (by groupName) -> ItemType -> [items...]
    const topMap = new Map(); // Map<groupName, Map<itemType, items[]>>
    const sectionsTouched = new Set();

    function groupNameOf(it) {
      const name = (it.foodCategoryGroupNameEnglish && String(it.foodCategoryGroupNameEnglish).trim()) || "";
      if (name) return name;
      const code = (it.foodCategoryGroupCode && String(it.foodCategoryGroupCode).trim()) || "";
      if (code) return code.charAt(0) + code.slice(1).toLowerCase();
      return "Uncategorized";
    }

    for (const it of items) {
      sectionsTouched.add(String(it.sectionKey || "").trim());

      const gName = groupNameOf(it);
      if (!topMap.has(gName)) topMap.set(gName, new Map());

      const typeName = (it.itemType && String(it.itemType).trim()) || "Uncategorized";
      const typeMap = topMap.get(gName);
      if (!typeMap.has(typeName)) typeMap.set(typeName, []);
      typeMap.get(typeName).push(it);
    }

    const tree = {};
    for (const [gName, typeMap] of Array.from(topMap.entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    )) {
      tree[gName] = {};
      for (const [typeName, list] of Array.from(typeMap.entries()).sort((a, b) =>
        a[0].localeCompare(b[0])
      )) {
        tree[gName][typeName] = list;
      }
    }

    const meta = await buildMetaForBranch(branch);

    const resp = {
      branchId: branch.branchId,
      branch: buildPublicBranchInfo(branch), // ✅ NEW
      ...(sectionKey ? { sectionKey } : {}),
      ...(codeFilter ? { foodCategoryGroupCode: codeFilter } : {}),
      totals: {
        items: items.length,
        foodCategories: Object.keys(tree).length,
      },
      sectionsTouched: Array.from(sectionsTouched).filter(Boolean).sort(),
      ...meta,
      menuStamp: buildMenuStamp(branch), // ✅ NEW
      tree,
      serverTime: new Date().toISOString(),
    };
    if (qr) resp.qr = qr;

    return res.json(resp);
  } catch (err) {
    const status = err.status || 500;
    return res
      .status(status)
      .json({ message: err.message || "Failed to load items grouped by food category" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: GET /api/public/menu/theme-mapping
export const getPublicThemeMapping = async (req, res) => {
  try {
    const { branch, qr } = await resolveContext(req);

    const sectionKey = String(req.query?.sectionKey || "").trim().toUpperCase();
    if (!sectionKey) {
      return res.status(400).json({ message: "sectionKey is required" });
    }

    const doc = await ThemeMapping.findOne({
      vendorId: branch.vendorId,
      branchId: branch.branchId, // business id
      sectionKey,
    })
      .select("vendorId branchId sectionKey itemTypeDesignMap updatedAt")
      .lean();

    if (!doc) {
      return res.status(404).json({ message: "Theme mapping not found" });
    }

    const clean = normalizeItemTypeDesignMap(doc.itemTypeDesignMap);

    const resp = {
      vendorId: doc.vendorId,
      branchId: doc.branchId,
      branch: buildPublicBranchInfo(branch), // ✅ NEW
      sectionKey: doc.sectionKey,
      itemTypeDesignMap: clean,
      updatedAt: doc.updatedAt,
      menuStamp: buildMenuStamp(branch), // ✅ NEW
      serverTime: new Date().toISOString(),
    };
    if (qr) resp.qr = qr;

    return res.json(resp);
  } catch (err) {
    const status = err.status || 500;
    return res
      .status(status)
      .json({ message: err.message || "Failed to load theme mapping" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: GET /api/public/menu/theme-mapping/all
export const getPublicThemeMappingAll = async (req, res) => {
  try {
    const { branch, qr } = await resolveContext(req);

    const rows = await ThemeMapping.find({
      vendorId: branch.vendorId,
      branchId: branch.branchId,
    })
      .select("sectionKey itemTypeDesignMap updatedAt")
      .sort({ sectionKey: 1 })
      .lean();

    const allowed = new Set(["01","02","03","04","05","06","07","08"]);

    const records = rows.map((r) => {
      const clean = {};
      for (const [k, v] of Object.entries(Object.fromEntries(r.itemTypeDesignMap || {}))) {
        const vv = String(v || "").padStart(2, "0");
        clean[k] = allowed.has(vv) ? vv : "01";
      }
      return {
        sectionKey: r.sectionKey,
        itemTypeDesignMap: clean,
        updatedAt: r.updatedAt,
      };
    });

    const resp = {
      vendorId: branch.vendorId,
      branchId: branch.branchId,
      branch: buildPublicBranchInfo(branch), // ✅ NEW
      count: records.length,
      records,
      menuStamp: buildMenuStamp(branch), // ✅ NEW
      serverTime: new Date().toISOString(),
    };
    if (qr) resp.qr = qr;

    return res.json(resp);
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ message: err.message || "Failed to load theme mappings" });
  }
};

// import mongoose from "mongoose";
// import Branch from "../models/Branch.js";
// import MenuItem from "../models/MenuItem.js";
// import Vendor from "../models/Vendor.js";
// import QrCode from "../models/QrCodeOrders.js"; // ✅ for QR-aware mode
// import ThemeMapping from "../models/ThemeMapping.js";


// // Safely get [key, value] pairs from Map | Object | null
// function entriesOf(maybeMapOrObj) {
//   if (!maybeMapOrObj) return [];
//   if (maybeMapOrObj instanceof Map) return Array.from(maybeMapOrObj.entries());
//   if (typeof maybeMapOrObj === "object" && !Array.isArray(maybeMapOrObj)) {
//     return Object.entries(maybeMapOrObj);
//   }
//   return [];
// }

// // Force codes to 01..08 and return a plain object
// function normalizeItemTypeDesignMap(raw) {
//   const allowed = new Set(["01","02","03","04","05","06","07","08"]);
//   const out = {};
//   for (const [k, v] of entriesOf(raw)) {
//     const vv = String(v || "").padStart(2, "0");
//     out[k] = allowed.has(vv) ? vv : "01";
//   }
//   return out;
// }


// // -----------------------------------------------------------------------------
// // Meta (currency + vendor VAT + settings)
// async function buildMetaForBranch(branch) {
//   const currency = branch?.currency ?? null;

//   let vendor = { vendorId: null, vatNumber: null, vatRate: null };
//   let settings = undefined;

//   if (branch?.vendorId) {
//     const v = await Vendor.findOne({ vendorId: branch.vendorId })
//       .select("vendorId billing.vatNumber taxes.vatPercentage settings.priceIncludesVat")
//       .lean();

//     if (v) {
//       const vatPct =
//         typeof v?.taxes?.vatPercentage === "number" ? v.taxes.vatPercentage : null;

//       vendor = {
//         vendorId: v.vendorId || null,
//         vatNumber: v?.billing?.vatNumber ?? null,
//         vatRate: vatPct !== null ? vatPct / 100 : null, // e.g. 10 -> 0.10
//       };

//       if (typeof v?.settings?.priceIncludesVat === "boolean") {
//         settings = { priceIncludesVat: v.settings.priceIncludesVat };
//       }
//     }
//   }
//   return { currency, vendor, settings };
// }
// function buildMenuStamp(branch) {
//   return {
//     menuVersion: typeof branch?.menuVersion === "number" ? branch.menuVersion : 1,
//     menuUpdatedAt: branch?.menuUpdatedAt ? new Date(branch.menuUpdatedAt).toISOString() : null,
//   };
// }

// // -----------------------------------------------------------------------------
// // Helpers for QR-aware flow (still under /api/public/*)
// function isObjectId(id) {
//   return mongoose.Types.ObjectId.isValid(String(id || ""));
// }
// function suffixOf(numStr) {
//   const m = /(\d+)$/.exec(String(numStr || ""));
//   return m ? parseInt(m[1], 10) : null;
// }
// function parseSeatFromQr({ type, number }) {
//   const kind = String(type || "").toLowerCase(); // "table" | "room"
//   const idx = suffixOf(number);
//   return {
//     kind: ["table", "room"].includes(kind) ? kind : undefined,
//     index: Number.isFinite(idx) ? idx : undefined,
//   };
// }

// /**
//  * Resolve context in ONE place:
//  * - If `qrId` is present, resolve via QR (premium flow). `branch` query becomes optional guard.
//  * - Else, require `branch` (free-tier flow).
//  * Returns: { branch, qr | undefined }
//  */
// async function resolveContext(req) {
//   const qrId = String(req.query?.qrId || req.query?.qr || "").trim();
//   const branchBizId = String(req.query?.branch || "").trim(); // optional when qrId given
//   const type = String(req.query?.type || "").trim().toLowerCase(); // optional
//   const number = String(req.query?.number || "").trim(); // optional

//   // --- Premium (QR) path
//   if (qrId) {
//     const qr = await QrCode.findOne({ qrId }).lean();
//     if (!qr) {
//       const err = new Error("QR not found");
//       err.status = 404;
//       throw err;
//     }
//     if (qr.active === false) {
//       const err = new Error("QR is inactive");
//       err.status = 410; // Gone
//       throw err;
//     }

//     // load branch via QR's stored Mongo _id (or fallback to branch= guard)
//     let branch = null;
//     if (isObjectId(qr.branchId)) {
//       branch = await Branch.findById(qr.branchId).lean();
//     }
//     if (!branch && branchBizId) {
//       branch = await Branch.findOne({ branchId: branchBizId }).lean();
//     }
//     if (!branch) {
//       const err = new Error("Branch not found for QR");
//       err.status = 404;
//       throw err;
//     }

//     // integrity (only if provided in query)
//     if (branchBizId && branch.branchId !== branchBizId) {
//       const err = new Error("branch mismatch between QR and request");
//       err.status = 409;
//       throw err;
//     }
//     if (qr.vendorId && branch.vendorId && qr.vendorId !== branch.vendorId) {
//       const err = new Error("vendor mismatch between QR and branch");
//       err.status = 409;
//       throw err;
//     }
//     if (type && String(qr.type || "").toLowerCase() !== type) {
//       const err = new Error("type mismatch for QR");
//       err.status = 409;
//       throw err;
//     }
//     if (number && String(qr.number || "") !== number) {
//       const err = new Error("number mismatch for QR");
//       err.status = 409;
//       throw err;
//     }

//     const seat = parseSeatFromQr({ type: qr.type, number: qr.number });
//     const qrPublic = {
//       qrId: qr.qrId,
//       type: qr.type,              // "table" | "room"
//       number: qr.number,          // e.g., "table-12"
//       label: qr.label ?? undefined,
//       active: qr.active !== false,
//       vendorId: qr.vendorId ?? undefined,
//       branchObjectId: String(qr.branchId || ""),
//       branchId: branch.branchId,  // business id (BR-xxxxx)
//       seat,                       // { kind, index }
//     };

//     return { branch, qr: qrPublic };
//   }

//   // --- Free-tier (explicit branch) path
//   if (!branchBizId) {
//     const err = new Error("branch is required (business id)");
//     err.status = 400;
//     throw err;
//   }
//   const branch = await Branch.findOne({ branchId: branchBizId }).lean();
//   if (!branch) {
//     const err = new Error("Branch not found");
//     err.status = 404;
//     throw err;
//   }
//   return { branch, qr: undefined };
// }

// // =====================================================================
// // PUBLIC ENDPOINTS (unchanged URLs) + optional QR support
// // base: /api/public/*
// // =====================================================================

// // ---------------------------------------------------------------------
// // GET /api/public/menu/sections?branch=BR-000005
// // ALSO works with: /api/public/menu/sections?qrId=QR-000138
// export const getPublicMenuTypes = async (req, res) => {
//   try {
//     const { branch, qr } = await resolveContext(req);

//     const sections = (branch.menuSections || [])
//       .filter((s) => s.isEnabled === true)
//       .map((s) => ({
//         key: s.key,
//         nameEnglish: s.nameEnglish,
//         nameArabic: s.nameArabic,
//         itemCount: s.itemCount ?? undefined,
//         icon: s.icon ?? undefined,
//       }));

//     const meta = await buildMetaForBranch(branch);

//     const resp = {
//       branchId: branch.branchId,
//       sections,
//       ...meta,
//       menuStamp: buildMenuStamp(branch), // ✅ NEW
//       serverTime: new Date().toISOString(),
//     };
//     if (qr) resp.qr = qr; // include seat info only when QR is used
//     return res.json(resp);
//   } catch (err) {
//     const status = err.status || 500;
//     return res.status(status).json({ message: err.message || "Failed to load sections" });
//   }
// };

// // ---------------------------------------------------------------------
// // GET /api/public/menu?branch=BR-000005
// // ALSO works with: /api/public/menu?qrId=QR-000138
// export const getPublicMenu = async (req, res) => {
//   try {
//     const { branch, qr } = await resolveContext(req);

//     const meta = await buildMetaForBranch(branch);

//     const resp = {
//       branch: {
//         branchId: branch.branchId,
//         vendorId: branch.vendorId,
//         nameEnglish: branch.nameEnglish,
//         nameArabic: branch.nameArabic,
//         currency: branch.currency,
//         taxes: branch.taxes,
//         branding: branch.branding,
//         menuSections: branch.menuSections,
//       },
//       ...meta,
//       menuStamp: buildMenuStamp(branch), // ✅ NEW
//       serverTime: new Date().toISOString(),
//     };
//     if (qr) resp.qr = qr;
//     return res.status(200).json(resp);
//   } catch (err) {
//     const status = err.status || 500;
//     return res.status(status).json({ message: err.message || "Failed to load menu" });
//   }
// };

// // ---------------------------------------------------------------------
// // GET /api/public/menu/items?branch=...&sectionKey=...&page=&limit=
// // ALSO works with: /api/public/menu/items?qrId=QR-000138&sectionKey=...&page=&limit=
// export const getPublicSectionItems = async (req, res) => {
//   try {
//     const sectionKey = String(req.query?.sectionKey || "").trim();
//     if (!sectionKey) {
//       return res.status(400).json({ message: "sectionKey is required" });
//     }

//     const page = Math.max(1, parseInt(String(req.query?.page || "1"), 10));
//     const limit = Math.min(100, Math.max(1, parseInt(String(req.query?.limit || "20"), 10)));
//     const skip = (page - 1) * limit;

//     const { branch, qr } = await resolveContext(req);

//     const query = {
//       branchId: branch.branchId, // business id
//       sectionKey,
//       isActive: true,
//       isAvailable: true,
//     };

//     const total = await MenuItem.countDocuments(query);
//     const items = await MenuItem.find(query)
//       .sort({ sortOrder: 1, nameEnglish: 1 })
//       .skip(skip)
//       .limit(limit)
//       .select(
//         "_id branchId vendorId sectionKey sortOrder itemType " +
//           "nameEnglish nameArabic description descriptionArabic imageUrl videoUrl " +
//           "allergens tags isFeatured isActive isAvailable isSpicy " +
//           "calories sku preparationTimeInMinutes ingredients addons " +
//           "isSizedBased sizes fixedPrice offeredPrice discount createdAt updatedAt"
//       )
//       .lean();

//     const meta = await buildMetaForBranch(branch);

//     const resp = {
//       branchId: branch.branchId,
//       sectionKey,
//       page,
//       limit,
//       total,
//       totalPages: Math.ceil(total / limit),
//       ...meta,
//       menuStamp: buildMenuStamp(branch), // ✅ NEW
//       items,
//     };
//     if (qr) resp.qr = qr;
//     return res.status(200).json(resp);
//   } catch (err) {
//     const status = err.status || 500;
//     return res.status(status).json({ message: err.message || "Failed to load items" });
//   }
// };

// // ---------------------------------------------------------------------
// // GET /api/public/menu/section-grouped?branch=...&sectionKey=...&limit=
// // ALSO works with: /api/public/menu/section-grouped?qrId=QR-000138&sectionKey=...&limit=
// export const getPublicSectionItemsGrouped = async (req, res) => {
//   try {
//     const sectionKey = String(req.query?.sectionKey || "").trim();
//     if (!sectionKey) {
//       return res.status(400).json({ message: "sectionKey is required" });
//     }

//     const hardCap = Math.min(1000, Math.max(1, parseInt(String(req.query?.limit || "1000"), 10)));

//     const { branch, qr } = await resolveContext(req);

//     const query = { branchId: branch.branchId, sectionKey, isActive: true, isAvailable: true };

//     const items = await MenuItem.find(query)
//       .sort({ sortOrder: 1, nameEnglish: 1 })
//       .limit(hardCap)
//       .lean();

//     // Group by itemType (fallback to "UNCATEGORIZED")
//     const map = new Map();
//     for (const it of items) {
//       const key = (it.itemType && String(it.itemType).trim()) || "UNCATEGORIZED";
//       if (!map.has(key)) map.set(key, []);
//       map.get(key).push(it);
//     }

//     const groups = Array.from(map.entries())
//       .sort((a, b) => a[0].localeCompare(b[0]))
//       .map(([itemType, list]) => ({
//         itemType,
//         count: list.length,
//         items: list,
//       }));

//     const meta = await buildMetaForBranch(branch);

//     const resp = {
//       branchId: branch.branchId,
//       sectionKey,
//       totalItems: items.length,
//       ...meta,
//       menuStamp: buildMenuStamp(branch), // ✅ NEW
//       groups,
//     };
//     if (qr) resp.qr = qr;
//     return res.json(resp);
//   } catch (err) {
//     const status = err.status || 500;
//     return res.status(status).json({ message: err.message || "Failed to load grouped items" });
//   }
// };

// // ---------------------------------------------------------------------
// // GET /api/public/menu/catalog?branch=...&maxPerSection=
// // ALSO works with: /api/public/menu/catalog?qrId=QR-000138&maxPerSection=
// export const getPublicBranchCatalog = async (req, res) => {
//   try {
//     const maxPerSection = Math.min(
//       2000,
//       Math.max(1, parseInt(String(req.query?.maxPerSection || "1000"), 10))
//     );

//     const { branch, qr } = await resolveContext(req);

//     const enabledSections = (branch.menuSections || []).filter((s) => s.isEnabled === true);

//     const sections = await Promise.all(
//       enabledSections.map(async (s) => {
//         const items = await MenuItem.find({
//           branchId: branch.branchId,
//           sectionKey: s.key,
//           isActive: true,
//           isAvailable: true,
//         })
//           .sort({ sortOrder: 1, nameEnglish: 1 })
//           .limit(maxPerSection)
//           .lean();

//         // Group by itemType
//         const gmap = new Map();
//         for (const it of items) {
//           const key = (it.itemType && String(it.itemType).trim()) || "UNCATEGORIZED";
//           if (!gmap.has(key)) gmap.set(key, []);
//           gmap.get(key).push(it);
//         }

//         const itemTypes = Array.from(gmap.entries())
//           .sort((a, b) => a[0].localeCompare(b[0]))
//           .map(([itemType, list]) => ({
//             itemType,
//             count: list.length,
//             items: list,
//           }));

//         return {
//           key: s.key,
//           nameEnglish: s.nameEnglish,
//           nameArabic: s.nameArabic,
//           itemCount: s.itemCount ?? undefined,
//           itemTypes,
//         };
//       })
//     );

//     const meta = await buildMetaForBranch(branch);

//     const resp = {
//       branch: {
//         branchId: branch.branchId,
//         nameEnglish: branch.nameEnglish,
//         nameArabic: branch.nameArabic,
//         currency: branch.currency ?? undefined,
//         taxes: branch.taxes ?? undefined,
//         branding: branch.branding ?? undefined,
//       },
//       ...meta,
//       menuStamp: buildMenuStamp(branch), // ✅ NEW
//       sections,
//       serverTime: new Date().toISOString(),
//     };
//     if (qr) resp.qr = qr;
//     return res.json(resp);
//   } catch (err) {
//     const status = err.status || 500;
//     return res.status(status).json({ message: err.message || "Failed to load catalog" });
//   }
// };

// // ---------------------------------------------------------------------
// // NEW: GET /api/public/menu/grouped-tree
// // Works with either ?branch=BR-000005 or ?qrId=QR-000138
// // Optional filters: &sectionKey=LUNCH  &foodCategoryGroupCode=MAIN  &limit=5000
// export const getPublicGroupedTree = async (req, res) => {
//   try {
//     const { branch, qr } = await resolveContext(req);

//     const sectionKey = String(req.query?.sectionKey || "").trim(); // optional
//     const rawCode = String(req.query?.foodCategoryGroupCode || "").trim();
//     const codeFilter = rawCode ? rawCode.toUpperCase() : null;
//     const hardCap = Math.min(20000, Math.max(1, parseInt(String(req.query?.limit || "5000"), 10)));

//     const query = {
//       branchId: branch.branchId,
//       isActive: true,
//       isAvailable: true,
//     };
//     if (sectionKey) query.sectionKey = sectionKey;
//     if (codeFilter) query.foodCategoryGroupCode = codeFilter;

//     const items = await MenuItem.find(query)
//       .sort({ sortOrder: 1, nameEnglish: 1 })
//       .limit(hardCap)
//       .select(
//         "_id branchId vendorId sectionKey sortOrder itemType " +
//           "nameEnglish nameArabic description descriptionArabic imageUrl videoUrl " +
//           "allergens tags isFeatured isActive isAvailable isSpicy " +
//           "calories sku preparationTimeInMinutes ingredients addons " +
//           "isSizedBased sizes fixedPrice offeredPrice discount createdAt updatedAt " +
//           "foodCategoryGroupCode foodCategoryGroupId foodCategoryGroupNameEnglish"
//       )
//       .lean();

//     // Build: FoodCategory (by groupName) -> ItemType -> [items...]
//     const topMap = new Map(); // Map<groupName, Map<itemType, items[]>>
//     const sectionsTouched = new Set();

//     function groupNameOf(it) {
//       const name = (it.foodCategoryGroupNameEnglish && String(it.foodCategoryGroupNameEnglish).trim()) || "";
//       if (name) return name; // Prefer the proper English name ("Mains", "Desserts")
//       const code = (it.foodCategoryGroupCode && String(it.foodCategoryGroupCode).trim()) || "";
//       if (code) return code.charAt(0) + code.slice(1).toLowerCase(); // "MAIN" -> "Main"
//       return "Uncategorized"; // never "UNCATEGORIZED" at top level
//     }

//     for (const it of items) {
//       sectionsTouched.add(String(it.sectionKey || "").trim());

//       const gName = groupNameOf(it);
//       if (!topMap.has(gName)) topMap.set(gName, new Map());

//       const typeName = (it.itemType && String(it.itemType).trim()) || "Uncategorized";
//       const typeMap = topMap.get(gName);
//       if (!typeMap.has(typeName)) typeMap.set(typeName, []);
//       typeMap.get(typeName).push(it);
//     }

//     // Convert maps -> plain object with alpha ordering
//     const tree = {};
//     for (const [gName, typeMap] of Array.from(topMap.entries()).sort((a, b) =>
//       a[0].localeCompare(b[0])
//     )) {
//       tree[gName] = {};
//       for (const [typeName, list] of Array.from(typeMap.entries()).sort((a, b) =>
//         a[0].localeCompare(b[0])
//       )) {
//         tree[gName][typeName] = list;
//       }
//     }

//     const meta = await buildMetaForBranch(branch);

//     const resp = {
//       branchId: branch.branchId,
//       ...(sectionKey ? { sectionKey } : {}),
//       ...(codeFilter ? { foodCategoryGroupCode: codeFilter } : {}),
//       totals: {
//         items: items.length,
//         foodCategories: Object.keys(tree).length,
//       },
//       sectionsTouched: Array.from(sectionsTouched).filter(Boolean).sort(),
//       ...meta,
//       menuStamp: buildMenuStamp(branch), // ✅ NEW
//       tree, // shape: { "Mains": { "Burger": [...], "Pizza": [...] }, "Desserts": { ... } }
//       serverTime: new Date().toISOString(),
//     };
//     if (qr) resp.qr = qr;

//     return res.json(resp);
//   } catch (err) {
//     const status = err.status || 500;
//     return res
//       .status(status)
//       .json({ message: err.message || "Failed to load items grouped by food category" });
//   }
// };






// // ─────────────────────────────────────────────────────────────────────────────
// // PUBLIC: GET /api/public/menu/theme-mapping
// // Accepts either ?branch=BR-xxxxx or ?qrId=QR-xxxxx (same as other public endpoints)
// // Requires: sectionKey
// // Returns: { vendorId, branchId, sectionKey, itemTypeDesignMap, serverTime }
// // 404 when no mapping record exists for the section.
// // ─────────────────────────────────────────────────────────────────────────────
// export const getPublicThemeMapping = async (req, res) => {
//   try {
//     const { branch } = await resolveContext(req);

//     const sectionKey = String(req.query?.sectionKey || "").trim().toUpperCase();
//     if (!sectionKey) {
//       return res.status(400).json({ message: "sectionKey is required" });
//     }

//     const doc = await ThemeMapping.findOne({
//       vendorId: branch.vendorId,
//       branchId: branch.branchId, // business id
//       sectionKey,
//     })
//       .select("vendorId branchId sectionKey itemTypeDesignMap updatedAt")
//       .lean();

//     if (!doc) {
//       return res.status(404).json({ message: "Theme mapping not found" });
//     }

//     // Normalize regardless of Map/Object shape, ensure codes are "01".."08"
//     const clean = normalizeItemTypeDesignMap(doc.itemTypeDesignMap);

//     return res.json({
//       vendorId: doc.vendorId,
//       branchId: doc.branchId,
//       sectionKey: doc.sectionKey,
//       itemTypeDesignMap: clean,
//       updatedAt: doc.updatedAt,
//       menuStamp: buildMenuStamp(branch), // ✅ NEW
//       serverTime: new Date().toISOString(),
//     });
//   } catch (err) {
//     const status = err.status || 500;
//     return res
//       .status(status)
//       .json({ message: err.message || "Failed to load theme mapping" });
//   }
// };

// // ─────────────────────────────────────────────────────────────────────────────
// // PUBLIC: GET /api/public/menu/theme-mapping/all
// // Returns ALL mappings for a branch (all sectionKeys) in one payload.
// // Accepts either ?branch=BR-xxxxx or ?qrId=QR-xxxxx
// // Shape:
// // {
// //   vendorId, branchId, count,
// //   records: [{ sectionKey, itemTypeDesignMap, updatedAt }, ...],
// //   serverTime
// // }
// // ─────────────────────────────────────────────────────────────────────────────
// export const getPublicThemeMappingAll = async (req, res) => {
//   try {
//     const { branch } = await resolveContext(req);

//     const rows = await ThemeMapping.find({
//       vendorId: branch.vendorId,
//       branchId: branch.branchId,
//     })
//       .select("sectionKey itemTypeDesignMap updatedAt")
//       .sort({ sectionKey: 1 })
//       .lean();

//     const allowed = new Set(["01","02","03","04","05","06","07","08"]);

//     const records = rows.map((r) => {
//       const clean = {};
//       for (const [k, v] of Object.entries(Object.fromEntries(r.itemTypeDesignMap || {}))) {
//         const vv = String(v || "").padStart(2, "0");
//         clean[k] = allowed.has(vv) ? vv : "01";
//       }
//       return {
//         sectionKey: r.sectionKey,
//         itemTypeDesignMap: clean,
//         updatedAt: r.updatedAt,
//       };
//     });

//     return res.json({
//       vendorId: branch.vendorId,
//       branchId: branch.branchId,
//       count: records.length,
//       records,
//       menuStamp: buildMenuStamp(branch), // ✅ NEW
//       serverTime: new Date().toISOString(),
//     });
//   } catch (err) {
//     const status = err.status || 500;
//     return res.status(status).json({ message: err.message || "Failed to load theme mappings" });
//   }
// };
