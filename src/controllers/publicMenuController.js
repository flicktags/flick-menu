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

// src/controllers/publicMenuController.js
import Branch from "../models/Branch.js";
import MenuItem from "../models/MenuItem.js";
import Vendor from "../models/Vendor.js";

// ---- helpers ---------------------------------------------------------------
function normalizeCurrency(branch) {
  // Prefer branch.currency object if present
  const c = branch?.currency || {};
  const code = c.code || branch?.currencyCode || "BHD";
  const symbol = c.symbol || branch?.currencySymbol || "BD";
  const fractionDigits =
    typeof c.fractionDigits === "number"
      ? c.fractionDigits
      : typeof branch?.currencyFractionDigits === "number"
      ? branch.currencyFractionDigits
      : 3; // BHD commonly uses 3 dp

  return { code, symbol, fractionDigits };
}

async function buildMetaForBranch(branch) {
  const currency = normalizeCurrency(branch);

  let vendor = { vendorId: null, vatNumber: null, vatRate: null };
  let settings = undefined;

  if (branch?.vendorId) {
    const v = await Vendor.findOne({ vendorId: branch.vendorId })
      .select("vendorId vatNumber vatRate priceIncludesVat")
      .lean();

    if (v) {
      vendor = {
        vendorId: v.vendorId || null,
        vatNumber: v.vatNumber || null,
        // Expecting a decimal like 0.10 (10%)
        vatRate: typeof v.vatRate === "number" ? v.vatRate : null,
      };
      if (typeof v.priceIncludesVat === "boolean") {
        settings = { priceIncludesVat: v.priceIncludesVat };
      }
    }
  }

  return { currency, vendor, settings };
}

// ---- GET /api/public/menu/sections?branch=... ------------------------------
export const getPublicMenuTypes = async (req, res) => {
  try {
    const branchId = String(req.query?.branch || "").trim();
    if (!branchId) {
      return res.status(400).json({ message: "branch is required (business id)" });
    }

    const branch = await Branch.findOne({ branchId })
      .select("branchId nameEnglish nameArabic menuSections vendorId currency currencyCode currencySymbol currencyFractionDigits")
      .lean();

    if (!branch) return res.status(404).json({ message: "Branch not found" });

    const sections = (branch.menuSections || [])
      .filter((s) => s.isEnabled === true)
      .map((s) => ({
        key: s.key,
        nameEnglish: s.nameEnglish,
        nameArabic: s.nameArabic,
        itemCount: s.itemCount ?? undefined,
        icon: s.icon ?? undefined,
      }));

    // Optional meta if you want it at this endpoint too (harmless extra fields)
    const meta = await buildMetaForBranch(branch);

    return res.json({
      branchId: branch.branchId,
      sections,
      ...meta,
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    console.error("getPublicMenuTypes error:", err);
    return res.status(500).json({ message: err.message });
  }
};

// ---- GET /api/public/menu?branch=... ---------------------------------------
export const getPublicMenu = async (req, res) => {
  try {
    const branchId = String(req.query?.branch || "").trim();
    if (!branchId) {
      return res.status(400).json({ message: "branch is required (business id)" });
    }

    const branch = await Branch.findOne({ branchId })
      .select(
        "branchId vendorId nameEnglish nameArabic currency taxes branding menuSections " +
          "currencyCode currencySymbol currencyFractionDigits"
      )
      .lean();

    if (!branch) {
      return res.status(404).json({ message: "Branch not found" });
    }

    const meta = await buildMetaForBranch(branch);

    return res.status(200).json({
      branch,
      ...meta,
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    console.error("PublicMenu Error:", err);
    return res.status(500).json({ message: err.message });
  }
};

// ---- GET /api/public/menu/items?branch=...&sectionKey=... -------------------
export const getPublicSectionItems = async (req, res) => {
  try {
    const branchId = String(req.query?.branch || "").trim();
    const sectionKey = String(req.query?.sectionKey || "").trim();
    const page = Math.max(1, parseInt(String(req.query?.page || "1"), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query?.limit || "20"), 10)));
    const skip = (page - 1) * limit;

    if (!branchId || !sectionKey) {
      return res.status(400).json({ message: "branch and sectionKey are required" });
    }

    const branch = await Branch.findOne({ branchId })
      .select("branchId vendorId currency currencyCode currencySymbol currencyFractionDigits")
      .lean();
    if (!branch) {
      return res.status(404).json({ message: "Branch not found" });
    }

    const query = {
      branchId,
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

    return res.status(200).json({
      branchId,
      sectionKey,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      ...meta,
      items,
    });
  } catch (err) {
    console.error("PublicSectionItems Error:", err);
    return res.status(500).json({ message: err.message });
  }
};

// ---- GET /api/public/menu/section-grouped?branch=...&sectionKey=... --------
// Optional: &limit=1000  (defaults to 1000)
export const getPublicSectionItemsGrouped = async (req, res) => {
  try {
    const branchId = String(req.query?.branch || "").trim();
    const sectionKey = String(req.query?.sectionKey || "").trim();
    const hardCap = Math.min(1000, Math.max(1, parseInt(String(req.query?.limit || "1000"), 10))); // return "all" by default, capped

    if (!branchId || !sectionKey) {
      return res.status(400).json({ message: "branch and sectionKey are required" });
    }

    const branch = await Branch.findOne({ branchId })
      .select("branchId vendorId currency currencyCode currencySymbol currencyFractionDigits")
      .lean();
    if (!branch) return res.status(404).json({ message: "Branch not found" });

    const query = { branchId, sectionKey, isActive: true, isAvailable: true };

    const items = await MenuItem.find(query)
      .sort({ sortOrder: 1, nameEnglish: 1 })
      .limit(hardCap)
      .lean();

    // Group by itemType (fallback to "UNCATEGORIZED" if empty)
    const map = new Map(); // itemType -> array
    for (const it of items) {
      const key = (it.itemType && String(it.itemType).trim()) || "UNCATEGORIZED";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(it);
    }

    // Build array output (stable sort by itemType)
    const groups = Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([itemType, list]) => ({
        itemType,
        count: list.length,
        items: list,
      }));

    const meta = await buildMetaForBranch(branch);

    return res.json({
      branchId,
      sectionKey,
      totalItems: items.length,
      ...meta, // <= currency + vendor + (optional) settings
      groups,
    });
  } catch (err) {
    console.error("getPublicSectionItemsGrouped error:", err);
    return res.status(500).json({ message: err.message });
  }
};

// ---- GET /api/public/menu/catalog?branch=... [&maxPerSection=...] -----------
export const getPublicBranchCatalog = async (req, res) => {
  try {
    const branchId = String(req.query?.branch || "").trim();
    const maxPerSection = Math.min(2000, Math.max(1, parseInt(String(req.query?.maxPerSection || "1000"), 10)));

    if (!branchId) {
      return res.status(400).json({ message: "branch is required (business id)" });
    }

    const branch = await Branch.findOne({ branchId })
      .select("branchId vendorId nameEnglish nameArabic currency taxes branding menuSections currencyCode currencySymbol currencyFractionDigits")
      .lean();

    if (!branch) return res.status(404).json({ message: "Branch not found" });

    const enabledSections = (branch.menuSections || []).filter((s) => s.isEnabled === true);

    // Pull items per section in parallel
    const sections = await Promise.all(
      enabledSections.map(async (s) => {
        const items = await MenuItem.find({
          branchId,
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

    return res.json({
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
    });
  } catch (err) {
    console.error("getPublicBranchCatalog error:", err);
    return res.status(500).json({ message: err.message });
  }
};
