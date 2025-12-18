import admin from "../config/firebase.js";
import Branch from "../models/Branch.js";
import Vendor from "../models/Vendor.js";
import MenuType from "../models/MenuType.js"; // for default names on enable
import { generateBranchId } from "../utils/generateBranchId.js";
import { generatePublicSlug } from "../utils/generatePublicSlug.js"; // ✅ NEW
import { touchBranchMenuStampByBizId } from "../utils/touchMenuStamp.js";


async function generateUniquePublicSlug(maxTries = 12) {
  for (let i = 0; i < maxTries; i++) {
    const slug = generatePublicSlug();
    const exists = await Branch.exists({ publicSlug: slug });
    if (!exists) return slug;
  }
  throw new Error("Failed to generate unique publicSlug");
}

export const registerBranch = async (req, res) => {
  try {
    const {
      token,
      vendorId,
      nameEnglish,
      nameArabic,
      venueType,
      serviceFeatures,
      openingHours,
      contact,
      address,
      timeZone,
      currency,
      branding,
      taxes,
      qrSettings,
      subscription,
    } = req.body;

    if (!token) {
      return res.status(400).json({ message: "Firebase token required" });
    }

    // verify Firebase token
    const decodedToken = await admin.auth().verifyIdToken(token);
    const userId = decodedToken.uid;

    // check vendor exists
    const vendor = await Vendor.findOne({ vendorId });
    if (!vendor) {
      return res.status(404).json({ message: "Vendor not found" });
    }



    // generate branchId
    const branchId = await generateBranchId();
    const publicSlug = await generateUniquePublicSlug(); // ✅ NEW

    // create branch
    const branch = await Branch.create({
      branchId,
      publicSlug, // ✅ NEW
      vendorId,
      userId,
      nameEnglish,
      nameArabic,
      venueType,
      serviceFeatures,
      openingHours,
      contact,
      address,
      timeZone,
      currency,
      branding,
      taxes,
      qrSettings,
      subscription,
    });

    res.status(201).json({ message: "Branch registered successfully", branch });
  } catch (error) {
    console.error("Branch Register Error:", error);
    res.status(500).json({ message: error.message });
  }
};


// controllers/branchController.js
export const listBranchesByVendor = async (req, res) => {
  try {
    const uid = req.user?.uid; // from verifyFirebaseToken
    if (!uid) return res.status(401).json({ message: "Unauthorized" });

    // Accept vendorId from /vendor/:vendorId or ?vendorId=
    let vendorId = req.params.vendorId || req.query.vendorId;
    // NEW: accept branchId as an exact match filter
    const branchId = (req.query.branchId || "").toString().trim();

    // Pagination
    const page  = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10), 1), 100);
    const skip  = (page - 1) * limit;

    const status = req.query.status?.toString().trim();
    const q      = req.query.q?.toString().trim();

    let baseFilter = {};
    let resolvedVendorId = vendorId || null;

    if (vendorId) {
      const vendor = await Vendor.findOne({ vendorId }).lean();
      if (!vendor) return res.status(404).json({ message: "Vendor not found" });

      if (vendor.userId === uid) {
        // Vendor owner → all branches in this vendor
        baseFilter = { vendorId };
      } else {
        // Branch manager must own at least one branch in this vendor
        const ownsAny = await Branch.exists({ vendorId, userId: uid });
        if (!ownsAny) {
          return res.status(403).json({ message: "Forbidden: you do not own this vendor" });
        }
        baseFilter = { vendorId, userId: uid };
      }
    } else {
      // Infer from user
      const ownerVendor = await Vendor.findOne({ userId: uid }).lean();
      if (ownerVendor) {
        resolvedVendorId = ownerVendor.vendorId;
        baseFilter = { vendorId: ownerVendor.vendorId };
      } else {
        // Branch manager across vendors
        baseFilter = { userId: uid };
      }
    }

    // Compose final filter
    const filter = { ...baseFilter };

    // NEW: branchId exact match (if provided)
    if (branchId) {
      filter.branchId = branchId;
    }

    if (status) filter.status = status;

    if (q) {
      filter.$or = [
        { branchId:        { $regex: q, $options: "i" } },
        { publicSlug:      { $regex: q, $options: "i" } },
        { nameEnglish:     { $regex: q, $options: "i" } },
        { nameArabic:      { $regex: q, $options: "i" } },
        { "address.city":  { $regex: q, $options: "i" } },
      ];
    }

    const [items, total] = await Promise.all([
      Branch.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Branch.countDocuments(filter),
    ]);

    return res.json({
      vendorId: resolvedVendorId,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      items,
    });
  } catch (err) {
    console.error("List branches error:", err);
    return res.status(500).json({ message: err.message });
  }
};

const loadBranchByPublicId = async (branchId) => {
  const branch = await Branch.findOne({ branchId }).lean(false); // lean(false) => real doc for save()
  return branch;
};

const ensureCanManageBranch = async (req, branch) => {
  // Allow branch owner or vendor owner
  const uid = req.user?.uid;
  if (!uid || !branch) return false;

  if (branch.userId === uid) return true;

  const vendor = await Vendor.findOne({ vendorId: branch.vendorId }).lean();
  if (vendor && vendor.userId === uid) return true;

  // (Optional) allow admin claim:
  // if (req.user?.admin === true) return true;

  return false;
};


export const updateBranchInformation = async (req, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ message: "Unauthorized" });

    const { branchId } = req.params;
    if (!branchId) return res.status(400).json({ message: "branchId is required" });

    const branch = await loadBranchByPublicId(branchId);
    if (!branch) return res.status(404).json({ message: "Branch not found" });

    if (!(await ensureCanManageBranch(req, branch))) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const b = req.body || {};

    // ✅ FIX: define days allowed in openingHours (matches Branch schema keys)
    const _DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

    // Basics
    if (b.nameEnglish !== undefined) branch.nameEnglish = String(b.nameEnglish);
    if (b.nameArabic  !== undefined) branch.nameArabic  = String(b.nameArabic);
    if (b.venueType   !== undefined) branch.venueType   = String(b.venueType);
    if (b.status      !== undefined) branch.status      = String(b.status);

    // Service features (replace if provided)
    if (Array.isArray(b.serviceFeatures)) {
      branch.serviceFeatures = b.serviceFeatures.filter((x) => _SERVICE.has(String(x)));
    }

    // Opening hours: merge days only provided
    if (b.openingHours && typeof b.openingHours === "object") {
      branch.openingHours = branch.openingHours || {};
      for (const [dayRaw, val] of Object.entries(b.openingHours)) {
        const day = String(dayRaw || "").trim();
        if (!_DAYS.includes(day)) continue;

        if (typeof val === "string") {
          branch.openingHours[day] = val;
        } else if (val && typeof val === "object") {
          if (val.closed === true) {
            branch.openingHours[day] = "Closed";
          } else {
            const open  = val.open  ?? "09:00";
            const close = val.close ?? "22:00";
            branch.openingHours[day] = `${open}-${close}`;
          }
        }
      }
    }

    // Contact
    if (b.contact && typeof b.contact === "object") {
      branch.contact = branch.contact || {};
      if (b.contact.email !== undefined) branch.contact.email = String(b.contact.email);
      if (b.contact.phone !== undefined) branch.contact.phone = String(b.contact.phone);
    }

    // Address (+coordinates)
    if (b.address && typeof b.address === "object") {
      branch.address = branch.address || {};
      const a = b.address;
      if (a.addressLine  !== undefined) branch.address.addressLine  = String(a.addressLine);
      if (a.city         !== undefined) branch.address.city         = String(a.city);
      if (a.state        !== undefined) branch.address.state        = String(a.state);
      if (a.countryCode  !== undefined) branch.address.countryCode  = String(a.countryCode);
      if (a.mapPlaceId   !== undefined) branch.address.mapPlaceId   = a.mapPlaceId ? String(a.mapPlaceId) : null;

      if (a.coordinates && typeof a.coordinates === "object") {
        branch.address.coordinates = branch.address.coordinates || {};
        if (a.coordinates.lat !== undefined) {
          branch.address.coordinates.lat = a.coordinates.lat === null ? null : Number(a.coordinates.lat);
        }
        if (a.coordinates.lng !== undefined) {
          branch.address.coordinates.lng = a.coordinates.lng === null ? null : Number(a.coordinates.lng);
        }
      }
    }

    // Meta
    if (b.timeZone !== undefined) branch.timeZone = String(b.timeZone);
    if (b.currency !== undefined) branch.currency = String(b.currency);

    // Branding
    if (b.branding && typeof b.branding === "object") {
      branch.branding = branch.branding || {};
      if (b.branding.logo !== undefined) branch.branding.logo = b.branding.logo ? String(b.branding.logo) : null;
      if (b.branding.coverBannerLogo !== undefined) {
        branch.branding.coverBannerLogo = b.branding.coverBannerLogo ? String(b.branding.coverBannerLogo) : null;
      }
      if (b.branding.splashScreenEnabled !== undefined) {
    branch.branding.splashScreenEnabled = !!b.branding.splashScreenEnabled;
  }
    }

    // Taxes
    if (b.taxes && typeof b.taxes === "object") {
      branch.taxes = branch.taxes || {};
      if (b.taxes.vatPercentage !== undefined) branch.taxes.vatPercentage = Number(b.taxes.vatPercentage);
      if (b.taxes.serviceChargePercentage !== undefined) {
        branch.taxes.serviceChargePercentage = Number(b.taxes.serviceChargePercentage);
      }
    }

    // QR Settings
    if (b.qrSettings && typeof b.qrSettings === "object") {
      branch.qrSettings = branch.qrSettings || {};
      if (b.qrSettings.qrsAllowed !== undefined) branch.qrSettings.qrsAllowed = !!b.qrSettings.qrsAllowed;
      if (b.qrSettings.noOfQrs !== undefined) branch.qrSettings.noOfQrs = Number(b.qrSettings.noOfQrs);
    }

    // Subscription
    if (b.subscription && typeof b.subscription === "object") {
      branch.subscription = branch.subscription || {};
      if (b.subscription.plan !== undefined) branch.subscription.plan = String(b.subscription.plan);
      if (b.subscription.expiryDate !== undefined) {
        branch.subscription.expiryDate = b.subscription.expiryDate
          ? new Date(b.subscription.expiryDate)
          : null;
      }
    }

    // ✅ Save branch
    await branch.save();

    // ✅ IMPORTANT: bump menu stamp so customer cached view knows something changed
    await touchBranchMenuStampByBizId(branch.branchId);

    // Re-fetch updated (includes new menuVersion/menuUpdatedAt)
    const updated = await Branch.findById(branch._id).lean();

    return res.json({ message: "Branch updated", branch: updated });
  } catch (err) {
    console.error("updateBranchInformation error:", err);
    return res.status(500).json({ message: err.message });
  }
};


// export const updateBranchInformation = async (req, res) => {
//   try {
//     const uid = req.user?.uid;
//     if (!uid) return res.status(401).json({ message: "Unauthorized" });

//     const { branchId } = req.params;
//     if (!branchId) return res.status(400).json({ message: "branchId is required" });

//     const branch = await loadBranchByPublicId(branchId);
//     if (!branch) return res.status(404).json({ message: "Branch not found" });

//     if (!(await ensureCanManageBranch(req, branch))) {
//       return res.status(403).json({ message: "Forbidden" });
//     }

//     const b = req.body || {};

//     // ✅ FIX: define days allowed in openingHours (matches Branch schema keys)
//     const _DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

//     // Basics
//     if (b.nameEnglish !== undefined) branch.nameEnglish = String(b.nameEnglish);
//     if (b.nameArabic  !== undefined) branch.nameArabic  = String(b.nameArabic);
//     if (b.venueType   !== undefined) branch.venueType   = String(b.venueType);
//     if (b.status      !== undefined) branch.status      = String(b.status);

//     // Service features (replace if provided)
//     if (Array.isArray(b.serviceFeatures)) {
//       branch.serviceFeatures = b.serviceFeatures.filter((x) => _SERVICE.has(String(x)));
//     }

//     // Opening hours: merge days only provided
//     if (b.openingHours && typeof b.openingHours === "object") {
//       branch.openingHours = branch.openingHours || {};
//       for (const [dayRaw, val] of Object.entries(b.openingHours)) {
//         const day = String(dayRaw || "").trim(); // ✅ safe (optional)
//         if (!_DAYS.includes(day)) continue;

//         if (typeof val === "string") {
//           branch.openingHours[day] = val;
//         } else if (val && typeof val === "object") {
//           if (val.closed === true) {
//             branch.openingHours[day] = "Closed";
//           } else {
//             const open  = val.open  ?? "09:00";
//             const close = val.close ?? "22:00";
//             branch.openingHours[day] = `${open}-${close}`;
//           }
//         }
//       }
//     }

//     // Contact
//     if (b.contact && typeof b.contact === "object") {
//       branch.contact = branch.contact || {};
//       if (b.contact.email !== undefined) branch.contact.email = String(b.contact.email);
//       if (b.contact.phone !== undefined) branch.contact.phone = String(b.contact.phone);
//     }

//     // Address (+coordinates)
//     if (b.address && typeof b.address === "object") {
//       branch.address = branch.address || {};
//       const a = b.address;
//       if (a.addressLine  !== undefined) branch.address.addressLine  = String(a.addressLine);
//       if (a.city         !== undefined) branch.address.city         = String(a.city);
//       if (a.state        !== undefined) branch.address.state        = String(a.state);
//       if (a.countryCode  !== undefined) branch.address.countryCode  = String(a.countryCode);
//       if (a.mapPlaceId   !== undefined) branch.address.mapPlaceId   = a.mapPlaceId ? String(a.mapPlaceId) : null;

//       if (a.coordinates && typeof a.coordinates === "object") {
//         branch.address.coordinates = branch.address.coordinates || {};
//         if (a.coordinates.lat !== undefined) {
//           branch.address.coordinates.lat = a.coordinates.lat === null ? null : Number(a.coordinates.lat);
//         }
//         if (a.coordinates.lng !== undefined) {
//           branch.address.coordinates.lng = a.coordinates.lng === null ? null : Number(a.coordinates.lng);
//         }
//       }
//     }

//     // Meta
//     if (b.timeZone !== undefined) branch.timeZone = String(b.timeZone);
//     if (b.currency !== undefined) branch.currency = String(b.currency);

//     // Branding
//     if (b.branding && typeof b.branding === "object") {
//       branch.branding = branch.branding || {};
//       if (b.branding.logo !== undefined) branch.branding.logo = b.branding.logo ? String(b.branding.logo) : null;
//       if (b.branding.coverBannerLogo !== undefined) {
//         branch.branding.coverBannerLogo = b.branding.coverBannerLogo ? String(b.branding.coverBannerLogo) : null;
//       }
//     }

//     // Taxes
//     if (b.taxes && typeof b.taxes === "object") {
//       branch.taxes = branch.taxes || {};
//       if (b.taxes.vatPercentage !== undefined) branch.taxes.vatPercentage = Number(b.taxes.vatPercentage);
//       if (b.taxes.serviceChargePercentage !== undefined) {
//         branch.taxes.serviceChargePercentage = Number(b.taxes.serviceChargePercentage);
//       }
//     }

//     // QR Settings
//     if (b.qrSettings && typeof b.qrSettings === "object") {
//       branch.qrSettings = branch.qrSettings || {};
//       if (b.qrSettings.qrsAllowed !== undefined) branch.qrSettings.qrsAllowed = !!b.qrSettings.qrsAllowed;
//       if (b.qrSettings.noOfQrs !== undefined) branch.qrSettings.noOfQrs = Number(b.qrSettings.noOfQrs);
//     }

//     // Subscription
//     if (b.subscription && typeof b.subscription === "object") {
//       branch.subscription = branch.subscription || {};
//       if (b.subscription.plan !== undefined) branch.subscription.plan = String(b.subscription.plan);
//       if (b.subscription.expiryDate !== undefined) {
//         branch.subscription.expiryDate = b.subscription.expiryDate
//           ? new Date(b.subscription.expiryDate)
//           : null;
//       }
//     }

//     await branch.save();
//     const updated = await Branch.findById(branch._id).lean();

//     return res.json({ message: "Branch updated", branch: updated });
//   } catch (err) {
//     console.error("updateBranchInformation error:", err);
//     return res.status(500).json({ message: err.message });
//   }
// };


// export const updateBranchInformation = async (req, res) => {
//   try {
//     const uid = req.user?.uid;
//     if (!uid) return res.status(401).json({ message: "Unauthorized" });

//     const { branchId } = req.params;
//     if (!branchId) return res.status(400).json({ message: "branchId is required" });

//     const branch = await loadBranchByPublicId(branchId);
//     if (!branch) return res.status(404).json({ message: "Branch not found" });

//     if (!(await ensureCanManageBranch(req, branch))) {
//       return res.status(403).json({ message: "Forbidden" });
//     }

//     const b = req.body || {};

//     // Basics
//     if (b.nameEnglish !== undefined) branch.nameEnglish = String(b.nameEnglish);
//     if (b.nameArabic  !== undefined) branch.nameArabic  = String(b.nameArabic);
//     if (b.venueType   !== undefined) branch.venueType   = String(b.venueType);
//     if (b.status      !== undefined) branch.status      = String(b.status);

//     // Service features (replace if provided)
//     if (Array.isArray(b.serviceFeatures)) {
//       branch.serviceFeatures = b.serviceFeatures.filter((x) => _SERVICE.has(String(x)));
//     }

//     // Opening hours: merge days only provided
//     if (b.openingHours && typeof b.openingHours === "object") {
//       branch.openingHours = branch.openingHours || {};
//       for (const [day, val] of Object.entries(b.openingHours)) {
//         if (!_DAYS.includes(day)) continue;
//         if (typeof val === "string") {
//           branch.openingHours[day] = val;
//         } else if (val && typeof val === "object") {
//           if (val.closed === true) {
//             branch.openingHours[day] = "Closed";
//           } else {
//             const open  = val.open  ?? "09:00";
//             const close = val.close ?? "22:00";
//             branch.openingHours[day] = `${open}-${close}`;
//           }
//         }
//       }
//     }

//     // Contact
//     if (b.contact && typeof b.contact === "object") {
//       branch.contact = branch.contact || {};
//       if (b.contact.email !== undefined) branch.contact.email = String(b.contact.email);
//       if (b.contact.phone !== undefined) branch.contact.phone = String(b.contact.phone);
//     }

//     // Address (+coordinates)
//     if (b.address && typeof b.address === "object") {
//       branch.address = branch.address || {};
//       const a = b.address;
//       if (a.addressLine  !== undefined) branch.address.addressLine  = String(a.addressLine);
//       if (a.city         !== undefined) branch.address.city         = String(a.city);
//       if (a.state        !== undefined) branch.address.state        = String(a.state);
//       if (a.countryCode  !== undefined) branch.address.countryCode  = String(a.countryCode);
//       if (a.mapPlaceId   !== undefined) branch.address.mapPlaceId   = a.mapPlaceId ? String(a.mapPlaceId) : null;

//       if (a.coordinates && typeof a.coordinates === "object") {
//         branch.address.coordinates = branch.address.coordinates || {};
//         if (a.coordinates.lat !== undefined) {
//           branch.address.coordinates.lat = a.coordinates.lat === null ? null : Number(a.coordinates.lat);
//         }
//         if (a.coordinates.lng !== undefined) {
//           branch.address.coordinates.lng = a.coordinates.lng === null ? null : Number(a.coordinates.lng);
//         }
//       }
//     }

//     // Meta
//     if (b.timeZone !== undefined) branch.timeZone = String(b.timeZone);
//     if (b.currency !== undefined) branch.currency = String(b.currency);

//     // Branding
//     if (b.branding && typeof b.branding === "object") {
//       branch.branding = branch.branding || {};
//       if (b.branding.logo !== undefined) branch.branding.logo = b.branding.logo ? String(b.branding.logo) : null;
//       if (b.branding.coverBannerLogo !== undefined) {
//         branch.branding.coverBannerLogo = b.branding.coverBannerLogo ? String(b.branding.coverBannerLogo) : null;
//       }
//     }

//     // Taxes
//     if (b.taxes && typeof b.taxes === "object") {
//       branch.taxes = branch.taxes || {};
//       if (b.taxes.vatPercentage !== undefined) branch.taxes.vatPercentage = Number(b.taxes.vatPercentage);
//       if (b.taxes.serviceChargePercentage !== undefined) {
//         branch.taxes.serviceChargePercentage = Number(b.taxes.serviceChargePercentage);
//       }
//     }

//     // QR Settings
//     if (b.qrSettings && typeof b.qrSettings === "object") {
//       branch.qrSettings = branch.qrSettings || {};
//       if (b.qrSettings.qrsAllowed !== undefined) branch.qrSettings.qrsAllowed = !!b.qrSettings.qrsAllowed;
//       if (b.qrSettings.noOfQrs !== undefined) branch.qrSettings.noOfQrs = Number(b.qrSettings.noOfQrs);
//     }

//     // Subscription
//     if (b.subscription && typeof b.subscription === "object") {
//       branch.subscription = branch.subscription || {};
//       if (b.subscription.plan !== undefined) branch.subscription.plan = String(b.subscription.plan);
//       if (b.subscription.expiryDate !== undefined) {
//         branch.subscription.expiryDate = b.subscription.expiryDate
//           ? new Date(b.subscription.expiryDate)
//           : null;
//       }
//     }

//     await branch.save();
//     const updated = await Branch.findById(branch._id).lean();

//     return res.json({ message: "Branch updated", branch: updated });
//   } catch (err) {
//     console.error("updateBranchInformation error:", err);
//     return res.status(500).json({ message: err.message });
//   }
// };


// ---------- GET /api/branches/:branchId/menu/sections ----------
export const getBranchMenuSections = async (req, res) => {
  try {
    const { branchId } = req.params;

    const branch = await loadBranchByPublicId(branchId);
    if (!branch) return res.status(404).json({ message: "Branch not found" });

    if (!(await ensureCanManageBranch(req, branch))) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const sections = [...(branch.menuSections || [])].sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.nameEnglish.localeCompare(b.nameEnglish)
    );

    return res.status(200).json({
      branchId: branch.branchId,
      vendorId: branch.vendorId,
      sections,
    });
  } catch (e) {
    console.error("getBranchMenuSections error:", e);
    return res.status(500).json({ message: e.message });
  }
};

// ---------- POST /api/branches/:branchId/menu/sections ----------
export const upsertBranchMenuSection = async (req, res) => {
  try {
    const { branchId } = req.params;
    let { key, nameEnglish, nameArabic, sortOrder } = req.body || {};
    if (!key) return res.status(400).json({ message: "key is required" });

    key = String(key).toUpperCase().trim();

    const branch = await loadBranchByPublicId(branchId);
    if (!branch) return res.status(404).json({ message: "Branch not found" });

    if (!(await ensureCanManageBranch(req, branch))) {
      return res.status(403).json({ message: "Forbidden" });
    }

    // Default labels from MenuType if missing
    if (!nameEnglish || !nameArabic) {
      const mt = await MenuType.findOne({ key }).lean();
      if (!mt && !nameEnglish) {
        return res.status(400).json({ message: "Unknown key and nameEnglish is missing" });
      }
      nameEnglish = nameEnglish ?? mt?.nameEnglish ?? key;
      nameArabic = nameArabic ?? mt?.nameArabic ?? "";
      if (sortOrder === undefined && mt?.sortOrder !== undefined) {
        sortOrder = mt.sortOrder;
      }
    }

    const list = branch.menuSections ?? [];
    const i = list.findIndex((s) => s.key === key);

    let created = false;
    if (i >= 0) {
      // update existing
      list[i].isEnabled = true;
      if (nameEnglish !== undefined) list[i].nameEnglish = nameEnglish;
      if (nameArabic !== undefined) list[i].nameArabic = nameArabic;
      if (sortOrder !== undefined) list[i].sortOrder = Number(sortOrder) || 0;
    } else {
      // push new
      list.push({
        key,
        nameEnglish,
        nameArabic: nameArabic ?? "",
        sortOrder: Number(sortOrder) || 0,
        isEnabled: true,
        itemCount: 0,
      });
      created = true;
    }

    branch.menuSections = list;
    await branch.save();

    const section = branch.menuSections.find((s) => s.key === key);
    return res
      .status(created ? 201 : 200)
      .json({
        message: created ? "Menu section enabled" : "Menu section updated",
        branchId: branch.branchId,
        section,
      });
  } catch (e) {
    console.error("upsertBranchMenuSection error:", e);
    return res.status(500).json({ message: e.message });
  }
};

// ---------- DELETE /api/branches/:branchId/menu/sections/:key?hard=true ----------
export const disableOrRemoveBranchMenuSection = async (req, res) => {
  try {
    const { branchId, key: rawKey } = req.params;
    const hard = String(req.query.hard ?? "false").toLowerCase() === "true";
    const key = String(rawKey).toUpperCase().trim();

    const branch = await loadBranchByPublicId(branchId);
    if (!branch) return res.status(404).json({ message: "Branch not found" });

    if (!(await ensureCanManageBranch(req, branch))) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const list = branch.menuSections ?? [];
    const i = list.findIndex((s) => s.key === key);
    if (i < 0) return res.status(404).json({ message: "Section not found" });

    if (hard) {
      list.splice(i, 1);
    } else {
      list[i].isEnabled = false;
    }

    branch.menuSections = list;
    await branch.save();

    return res.status(200).json({
      message: hard ? "Menu section removed" : "Menu section disabled",
      branchId: branch.branchId,
      key,
    });
  } catch (e) {
    console.error("disableOrRemoveBranchMenuSection error:", e);
    return res.status(500).json({ message: e.message });
  }
};