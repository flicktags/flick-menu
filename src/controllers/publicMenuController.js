// // src/controllers/publicMenuController.js
// import Branch from "../models/Branch.js";
// // ⬇️ Change this import to your real menu item model file if named differently
// import MenuItem from "../models/MenuItem.js";



// // GET /api/public/menu/sections?branch=BR-000005
// export const getPublicMenuTypes = async (req, res) => {
//   try {
//     const branchId = String(req.query?.branch || "").trim();
//     if (!branchId) {
//       return res.status(400).json({ message: "branch is required (business id)" });
//     }

//     const branch = await Branch.findOne({ branchId })
//       .select("branchId nameEnglish nameArabic menuSections")
//       .lean();

//     if (!branch) return res.status(404).json({ message: "Branch not found" });

//     const sections = (branch.menuSections || [])
//       .filter((s) => s.isEnabled === true)
//       .map((s) => ({
//         key: s.key,
//         nameEnglish: s.nameEnglish,
//         nameArabic: s.nameArabic,
//         itemCount: s.itemCount ?? undefined,
//         icon: s.icon ?? undefined,
//       }));

//     return res.json({
//       branchId: branch.branchId,
//       sections,
//       serverTime: new Date().toISOString(),
//     });
//   } catch (err) {
//     console.error("getPublicMenuTypes error:", err);
//     return res.status(500).json({ message: err.message });
//   }
// };


// export const getPublicMenu = async (req, res) => {
//   try {
//     const branchId = String(req.query?.branch || "").trim();
//     if (!branchId) {
//       return res.status(400).json({ message: "branch is required (business id)" });
//     }

//     const branch = await Branch.findOne({ branchId })
//       .select(
//         "branchId nameEnglish nameArabic currency taxes branding menuSections"
//       )
//       .lean();

//     if (!branch) {
//       return res.status(404).json({ message: "Branch not found" });
//     }

//     return res.status(200).json({
//       branch,
//       serverTime: new Date().toISOString(),
//     });
//   } catch (err) {
//     console.error("PublicMenu Error:", err);
//     return res.status(500).json({ message: err.message });
//   }
// };

//  export const getPublicSectionItems = async (req, res) => {
//    try {
//      const branchId = String(req.query?.branch || "").trim();
//      const sectionKey = String(req.query?.sectionKey || "").trim();
//      const page = Math.max(1, parseInt(String(req.query?.page || "1"), 10));
//      const limit = Math.min(100, Math.max(1, parseInt(String(req.query?.limit || "20"), 10)));
//      const skip = (page - 1) * limit;

//      if (!branchId || !sectionKey) {
//        return res.status(400).json({ message: "branch and sectionKey are required" });
//      }

//      const branch = await Branch.findOne({ branchId }).select("branchId").lean();
//      if (!branch) {
//        return res.status(404).json({ message: "Branch not found" });
//      }

//      const query = {
//        branchId,
//        sectionKey,
//        isActive: true,
//        isAvailable: true,
//      };

//         const total = await MenuItem.countDocuments(query);
//     const items = await MenuItem.find(query)
//       .sort({ sortOrder: 1, nameEnglish: 1 }) // tweak as you like
//       .skip(skip)
//       .limit(limit)
//       .select(
//         "_id branchId vendorId sectionKey sortOrder itemType " +
//           "nameEnglish nameArabic description imageUrl videoUrl " +
//           "allergens tags isFeatured isActive isAvailable isSpicy " +
//           "calories sku preparationTimeInMinutes ingredients addons " +
//           "isSizedBased sizes fixedPrice offeredPrice discount createdAt updatedAt"
//       )
//       .lean();

//      return res.status(200).json({
//        branchId,
//        sectionKey,
//        page,
//        limit,
//        total,
//        totalPages: Math.ceil(total / limit),
//        items,
//      });
//    } catch (err) {
//      console.error("PublicSectionItems Error:", err);
//      return res.status(500).json({ message: err.message });
//    }
//  };

//  // GET /api/public/menu/section-grouped?branch=BR-000005&sectionKey=BREAKFAST
// // Optional: &limit=1000  (defaults to 1000)
// export const getPublicSectionItemsGrouped = async (req, res) => {
//   try {
//     const branchId = String(req.query?.branch || "").trim();
//     const sectionKey = String(req.query?.sectionKey || "").trim();
//     const hardCap = Math.min(1000, Math.max(1, parseInt(String(req.query?.limit || "1000"), 10))); // return "all" by default, capped

//     if (!branchId || !sectionKey) {
//       return res.status(400).json({ message: "branch and sectionKey are required" });
//     }

//     const branch = await Branch.findOne({ branchId }).select("branchId").lean();
//     if (!branch) return res.status(404).json({ message: "Branch not found" });

//     const query = { branchId, sectionKey, isActive: true, isAvailable: true };

//     const items = await MenuItem.find(query)
//       .sort({ sortOrder: 1, nameEnglish: 1 })
//       .limit(hardCap)
//       .lean();

//     // Group by itemType (fallback to "UNCATEGORIZED" if empty)
//     const map = new Map(); // itemType -> array
//     for (const it of items) {
//       const key = (it.itemType && String(it.itemType).trim()) || "UNCATEGORIZED";
//       if (!map.has(key)) map.set(key, []);
//       map.get(key).push(it);
//     }

//     // Build array output (stable sort by itemType)
//     const groups = Array.from(map.entries())
//       .sort((a, b) => a[0].localeCompare(b[0]))
//       .map(([itemType, list]) => ({
//         itemType,
//         count: list.length,
//         items: list,
//       }));

//     return res.json({
//       branchId,
//       sectionKey,
//       totalItems: items.length,
//       groups,
//     });
//   } catch (err) {
//     console.error("getPublicSectionItemsGrouped error:", err);
//     return res.status(500).json({ message: err.message });
//   }
// };

// // GET /api/public/menu/catalog?branch=BR-000005
// // Optional: &maxPerSection=1000
// export const getPublicBranchCatalog = async (req, res) => {
//   try {
//     const branchId = String(req.query?.branch || "").trim();
//     const maxPerSection = Math.min(2000, Math.max(1, parseInt(String(req.query?.maxPerSection || "1000"), 10)));

//     if (!branchId) {
//       return res.status(400).json({ message: "branch is required (business id)" });
//     }

//     const branch = await Branch.findOne({ branchId })
//       .select("branchId nameEnglish nameArabic currency taxes branding menuSections")
//       .lean();

//     if (!branch) return res.status(404).json({ message: "Branch not found" });

//     const enabledSections = (branch.menuSections || []).filter((s) => s.isEnabled === true);

//     // Pull items per section in parallel
//     const sections = await Promise.all(
//       enabledSections.map(async (s) => {
//         const items = await MenuItem.find({
//           branchId,
//           sectionKey: s.key,
//           isActive: true,
//           isAvailable: true,
//         })
//           .sort({ sortOrder: 1, nameEnglish: 1 })
//           .limit(maxPerSection)
//           // no projection -> all fields
//           // .select('+addons +addons.options') // only if needed
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

//     return res.json({
//       branch: {
//         branchId: branch.branchId,
//         nameEnglish: branch.nameEnglish,
//         nameArabic: branch.nameArabic,
//         currency: branch.currency ?? undefined,
//         taxes: branch.taxes ?? undefined,
//         branding: branch.branding ?? undefined,
//       },
//       sections,
//       serverTime: new Date().toISOString(),
//     });
//   } catch (err) {
//     console.error("getPublicBranchCatalog error:", err);
//     return res.status(500).json({ message: err.message });
//   }
// };

// // src/controllers/publicMenuController.js
// import Branch from "../models/Branch.js";
// import MenuItem from "../models/MenuItem.js";
// import Vendor from "../models/Vendor.js";

// // -----------------------------------------------------------------------------
// // Build extra metadata (currency from branch as-is, VAT info from vendor)
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
//         // expose decimal (e.g., 10% -> 0.10)
//         vatRate: vatPct !== null ? vatPct / 100 : null,
//       };

//       if (typeof v?.settings?.priceIncludesVat === "boolean") {
//         settings = { priceIncludesVat: v.settings.priceIncludesVat };
//       }
//     }
//   }

//   return { currency, vendor, settings };
// }

// // -----------------------------------------------------------------------------
// // GET /api/public/menu/sections?branch=BR-000005
// export const getPublicMenuTypes = async (req, res) => {
//   try {
//     const branchId = String(req.query?.branch || "").trim();
//     if (!branchId) {
//       return res.status(400).json({ message: "branch is required (business id)" });
//     }

//     const branch = await Branch.findOne({ branchId })
//       .select("branchId vendorId nameEnglish nameArabic menuSections currency")
//       .lean();

//     if (!branch) return res.status(404).json({ message: "Branch not found" });

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

//     return res.json({
//       branchId: branch.branchId,
//       sections,
//       ...meta,
//       serverTime: new Date().toISOString(),
//     });
//   } catch (err) {
//     console.error("getPublicMenuTypes error:", err);
//     return res.status(500).json({ message: err.message });
//   }
// };

// // -----------------------------------------------------------------------------
// // GET /api/public/menu?branch=BR-000005
// export const getPublicMenu = async (req, res) => {
//   try {
//     const branchId = String(req.query?.branch || "").trim();
//     if (!branchId) {
//       return res.status(400).json({ message: "branch is required (business id)" });
//     }

//     const branch = await Branch.findOne({ branchId })
//       .select(
//         "branchId vendorId nameEnglish nameArabic currency taxes branding menuSections"
//       )
//       .lean();

//     if (!branch) {
//       return res.status(404).json({ message: "Branch not found" });
//     }

//     const meta = await buildMetaForBranch(branch);

//     return res.status(200).json({
//       branch,
//       ...meta,
//       serverTime: new Date().toISOString(),
//     });
//   } catch (err) {
//     console.error("PublicMenu Error:", err);
//     return res.status(500).json({ message: err.message });
//   }
// };

// // -----------------------------------------------------------------------------
// // GET /api/public/menu/items?branch=...&sectionKey=...&page=&limit=
// export const getPublicSectionItems = async (req, res) => {
//   try {
//     const branchId = String(req.query?.branch || "").trim();
//     const sectionKey = String(req.query?.sectionKey || "").trim();
//     const page = Math.max(1, parseInt(String(req.query?.page || "1"), 10));
//     const limit = Math.min(100, Math.max(1, parseInt(String(req.query?.limit || "20"), 10)));
//     const skip = (page - 1) * limit;

//     if (!branchId || !sectionKey) {
//       return res.status(400).json({ message: "branch and sectionKey are required" });
//     }

//     const branch = await Branch.findOne({ branchId })
//       .select("branchId vendorId currency")
//       .lean();
//     if (!branch) {
//       return res.status(404).json({ message: "Branch not found" });
//     }

//     const query = {
//       branchId,
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

//     return res.status(200).json({
//       branchId,
//       sectionKey,
//       page,
//       limit,
//       total,
//       totalPages: Math.ceil(total / limit),
//       ...meta,
//       items,
//     });
//   } catch (err) {
//     console.error("PublicSectionItems Error:", err);
//     return res.status(500).json({ message: err.message });
//   }
// };

// // -----------------------------------------------------------------------------
// // GET /api/public/menu/section-grouped?branch=...&sectionKey=...&limit=
// export const getPublicSectionItemsGrouped = async (req, res) => {
//   try {
//     const branchId = String(req.query?.branch || "").trim();
//     const sectionKey = String(req.query?.sectionKey || "").trim();
//     const hardCap = Math.min(
//       1000,
//       Math.max(1, parseInt(String(req.query?.limit || "1000"), 10))
//     );

//     if (!branchId || !sectionKey) {
//       return res.status(400).json({ message: "branch and sectionKey are required" });
//     }

//     const branch = await Branch.findOne({ branchId })
//       .select("branchId vendorId currency")
//       .lean();
//     if (!branch) return res.status(404).json({ message: "Branch not found" });

//     const query = { branchId, sectionKey, isActive: true, isAvailable: true };

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

//     return res.json({
//       branchId,
//       sectionKey,
//       totalItems: items.length,
//       ...meta,
//       groups,
//     });
//   } catch (err) {
//     console.error("getPublicSectionItemsGrouped error:", err);
//     return res.status(500).json({ message: err.message });
//   }
// };

// // -----------------------------------------------------------------------------
// // GET /api/public/menu/catalog?branch=...&maxPerSection=
// export const getPublicBranchCatalog = async (req, res) => {
//   try {
//     const branchId = String(req.query?.branch || "").trim();
//     const maxPerSection = Math.min(
//       2000,
//       Math.max(1, parseInt(String(req.query?.maxPerSection || "1000"), 10))
//     );

//     if (!branchId) {
//       return res.status(400).json({ message: "branch is required (business id)" });
//     }

//     const branch = await Branch.findOne({ branchId })
//       .select(
//         "branchId vendorId nameEnglish nameArabic currency taxes branding menuSections"
//       )
//       .lean();

//     if (!branch) return res.status(404).json({ message: "Branch not found" });

//     const enabledSections = (branch.menuSections || []).filter((s) => s.isEnabled === true);

//     const sections = await Promise.all(
//       enabledSections.map(async (s) => {
//         const items = await MenuItem.find({
//           branchId,
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

//     return res.json({
//       branch: {
//         branchId: branch.branchId,
//         nameEnglish: branch.nameEnglish,
//         nameArabic: branch.nameArabic,
//         currency: branch.currency ?? undefined,
//         taxes: branch.taxes ?? undefined,
//         branding: branch.branding ?? undefined,
//       },
//       ...meta,
//       sections,
//       serverTime: new Date().toISOString(),
//     });
//   } catch (err) {
//     console.error("getPublicBranchCatalog error:", err);
//     return res.status(500).json({ message: err.message });
//   }
// };

// src/controllers/publicMenuController.js
// src/controllers/publicMenuController.js
import mongoose from "mongoose";
import Branch from "../models/Branch.js";
import MenuItem from "../models/MenuItem.js";
import Vendor from "../models/Vendor.js";
import QrCode from "../models/QrCodeOrders.js"; // ✅ for QR-aware mode

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
export const getPublicMenuTypes = async (req, res) => {
  try {
    const { branch, qr } = await resolveContext(req);

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
      sections,
      ...meta,
      serverTime: new Date().toISOString(),
    };
    if (qr) resp.qr = qr; // include seat info only when QR is used
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
      },
      ...meta,
      serverTime: new Date().toISOString(),
    };
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
      sectionKey,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      ...meta,
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

    // ---- helpers (robust to different shapes) ----
    const getFoodCategoryKey = (it) => {
      const fc = it.foodCategory;
      // supports: string, { key }, or separate foodCategoryKey
      if (typeof fc === "string" && fc.trim()) return fc.trim();
      if (fc && typeof fc === "object" && fc.key) return String(fc.key).trim();
      if (it.foodCategoryKey) return String(it.foodCategoryKey).trim();
      return "UNCATEGORIZED";
    };

    const getItemTypeKey = (it) => {
      const t = it.itemType;
      // supports: string or { key }
      if (typeof t === "string" && t.trim()) return t.trim();
      if (t && typeof t === "object" && t.key) return String(t.key).trim();
      return "UNSPECIFIED";
    };

    // ---- group: foodCategory -> itemType -> items ----
    const categoryMap = new Map(); // Map<foodCategory, Map<itemType, Item[]>>

    for (const it of items) {
      const fcKey = getFoodCategoryKey(it);
      const itKey = getItemTypeKey(it);

      if (!categoryMap.has(fcKey)) categoryMap.set(fcKey, new Map());
      const typeMap = categoryMap.get(fcKey);

      if (!typeMap.has(itKey)) typeMap.set(itKey, []);
      typeMap.get(itKey).push(it);
    }

    const groups = Array.from(categoryMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([foodCategory, typeMap]) => {
        const itemTypeGroups = Array.from(typeMap.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([itemType, list]) => ({
            itemType,
            count: list.length,
            items: list,
          }));

        const count = itemTypeGroups.reduce((sum, g) => sum + g.count, 0);

        return {
          foodCategory,
          count,
          itemTypeGroups,
        };
      });

    const meta = await buildMetaForBranch(branch);

    const resp = {
      branchId: branch.branchId,
      sectionKey,
      totalItems: items.length,
      ...meta,
      groups, // now: [{ foodCategory, count, itemTypeGroups: [{ itemType, count, items }] }]
    };
    if (qr) resp.qr = qr;

    return res.json(resp);
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ message: err.message || "Failed to load grouped items" });
  }
};


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
//       groups,
//     };
//     if (qr) resp.qr = qr;
//     return res.json(resp);
//   } catch (err) {
//     const status = err.status || 500;
//     return res.status(status).json({ message: err.message || "Failed to load grouped items" });
//   }
// };

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
      },
      ...meta,
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
