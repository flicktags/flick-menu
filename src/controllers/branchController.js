// controllers/branchController.js
import admin from "../config/firebase.js";
import Branch from "../models/Branch.js";
import Vendor from "../models/Vendor.js";
import MenuType from "../models/MenuType.js";
import { generateBranchId } from "../utils/generateBranchId.js";
import { generatePublicSlug } from "../utils/generatePublicSlug.js";
import { touchBranchMenuStampByBizId } from "../utils/touchMenuStamp.js";

// NOTE: Make sure you have this somewhere in your project.
// If you already have it in the old file, keep the same values.
const _SERVICE = new Set([
  "dineIn",
  "takeAway",
  "delivery",
  "pickup",
  "carHop",
  "roomService",
]);

async function generateUniquePublicSlug(maxTries = 12) {
  for (let i = 0; i < maxTries; i++) {
    const slug = generatePublicSlug();
    const exists = await Branch.exists({ publicSlug: slug });
    if (!exists) return slug;
  }
  throw new Error("Failed to generate unique publicSlug");
}

// -------------------- INTERNAL HELPERS --------------------

const loadBranchByPublicId = async (branchId) => {
  const branch = await Branch.findOne({ branchId }).lean(false); // real doc for save()
  return branch;
};

const ensureCanManageBranch = async (req, branch) => {
  const uid = req.user?.uid;
  if (!uid || !branch) return false;

  if (branch.userId === uid) return true;

  const vendor = await Vendor.findOne({ vendorId: branch.vendorId }).lean();
  if (vendor && vendor.userId === uid) return true;

  return false;
};

const toBool = (v) => {
  if (v === true || v === false) return v;
  if (typeof v === "string") return v.toLowerCase() === "true";
  if (typeof v === "number") return v === 1;
  return false;
};

// ✅ Always return boolean even if missing in older DB docs
const withStationBased = (branchObj) => {
  if (!branchObj) return branchObj;
  return {
    ...branchObj,
    stationBased: !!branchObj.stationBased,
  };
};

// -------------------- REGISTER BRANCH --------------------

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

      // optional from FE (plan only). expiryDate is controlled by backend
      subscription,

      // customization (backend forces default below)
      customization,

      // ✅ NEW
      stationBased,
    } = req.body;

    if (!token) {
      return res.status(400).json({ message: "Firebase token required" });
    }

    // verify Firebase token
    const decodedToken = await admin.auth().verifyIdToken(token);
    const userId = decodedToken.uid;

    // check vendor exists
    const vendor = await Vendor.findOne({ vendorId }).lean();
    if (!vendor) {
      return res.status(404).json({ message: "Vendor not found" });
    }

    // generate branchId + slug
    const branchId = await generateBranchId();
    const publicSlug = await generateUniquePublicSlug();

    // backend-controlled createdAt
    const createdAt = new Date();

    // 30 days trial
    const trialDays = 30;
    const expiryDate = new Date(
      createdAt.getTime() + trialDays * 24 * 60 * 60 * 1000,
    );

    // plan: allow FE to send plan, otherwise default "trial"
    const plan =
      subscription && typeof subscription === "object" && subscription.plan
        ? String(subscription.plan).trim()
        : "trial";

    // normalize taxes payload
    const vatPct = taxes?.vatPercentage ?? vendor?.taxes?.vatPercentage ?? 0;
    const svcPct = taxes?.serviceChargePercentage ?? 0;

    const vatNumber =
      (taxes?.vatNumber && String(taxes.vatNumber).trim()) ||
      (vendor?.billing?.vatNumber && String(vendor.billing.vatNumber).trim()) ||
      "";

    const isVatInclusive =
      taxes?.isVatInclusive !== undefined
        ? !!taxes.isVatInclusive
        : vendor?.taxes?.isVatInclusive !== undefined
          ? !!vendor.taxes.isVatInclusive
          : true;

    // ✅ Force customization defaults on register
    const customizationObj = {
      isClassicMenu: false,
      // later you can add more keys here
    };

    // ✅ NEW: stationBased defaults to false if FE doesn't send it
    const stationBasedBool =
      stationBased !== undefined ? toBool(stationBased) : false;

    // create branch
    const branch = await Branch.create({
      branchId,
      publicSlug,
      vendorId,
      userId,
      nameEnglish,
      nameArabic,
      venueType,

      // ✅ NEW
      stationBased: stationBasedBool,

      // serviceFeatures: if FE sends, allow only whitelisted keys
      serviceFeatures: Array.isArray(serviceFeatures)
        ? serviceFeatures.filter((x) => _SERVICE.has(String(x)))
        : undefined,

      openingHours,
      contact,
      address,
      timeZone,
      currency,
      branding,
      taxes: {
        vatPercentage: Number(vatPct) || 0,
        serviceChargePercentage: Number(svcPct) || 0,
        vatNumber,
        isVatInclusive,

        platformFeePerOrder: null,
        showPlatformFee: true,
        platformFeePaidByCustomer: true,
      },
      qrSettings,

      subscription: { plan, expiryDate },

      customization: customizationObj,

      createdAt,
      updatedAt: createdAt,
    });

    // ✅ Return with guaranteed boolean stationBased
    return res.status(201).json({
      message: "Branch registered successfully",
      branch: withStationBased(branch.toObject ? branch.toObject() : branch),
    });
  } catch (error) {
    console.error("Branch Register Error:", error);
    return res.status(500).json({ message: error.message });
  }
};

// -------------------- LIST BRANCHES --------------------

export const listBranchesByVendor = async (req, res) => {
  try {
    const uid = req.user?.uid; // from verifyFirebaseToken
    if (!uid) return res.status(401).json({ message: "Unauthorized" });

    // Accept vendorId from /vendor/:vendorId or ?vendorId=
    let vendorId = req.params.vendorId || req.query.vendorId;
    // accept branchId as an exact match filter
    const branchId = (req.query.branchId || "").toString().trim();

    // Pagination
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit || "20", 10), 1),
      100,
    );
    const skip = (page - 1) * limit;

    const status = req.query.status?.toString().trim();
    const q = req.query.q?.toString().trim();

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
          return res
            .status(403)
            .json({ message: "Forbidden: you do not own this vendor" });
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

    const filter = { ...baseFilter };

    if (branchId) filter.branchId = branchId;
    if (status) filter.status = status;

    if (q) {
      filter.$or = [
        { branchId: { $regex: q, $options: "i" } },
        { publicSlug: { $regex: q, $options: "i" } },
        { nameEnglish: { $regex: q, $options: "i" } },
        { nameArabic: { $regex: q, $options: "i" } },
        { "address.city": { $regex: q, $options: "i" } },
      ];
    }

    const [itemsRaw, total] = await Promise.all([
      Branch.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Branch.countDocuments(filter),
    ]);

    // ✅ Guarantee stationBased exists and is boolean (backward compatible)
    const items = (Array.isArray(itemsRaw) ? itemsRaw : []).map(withStationBased);

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

// -------------------- UPDATE BRANCH --------------------

export const updateBranchInformation = async (req, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ message: "Unauthorized" });

    const { branchId } = req.params;
    if (!branchId)
      return res.status(400).json({ message: "branchId is required" });

    const branch = await loadBranchByPublicId(branchId);
    if (!branch) return res.status(404).json({ message: "Branch not found" });

    if (!(await ensureCanManageBranch(req, branch))) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const b = req.body || {};

    const _DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

    // Basics
    if (b.nameEnglish !== undefined) branch.nameEnglish = String(b.nameEnglish);
    if (b.nameArabic !== undefined) branch.nameArabic = String(b.nameArabic);
    if (b.venueType !== undefined) branch.venueType = String(b.venueType);
    if (b.status !== undefined) branch.status = String(b.status);

    // ✅ NEW: StationBased toggle
    // MUST allow false, so check undefined only
    if (b.stationBased !== undefined) {
      branch.stationBased = toBool(b.stationBased);
    }

    // Service features
    if (Array.isArray(b.serviceFeatures)) {
      branch.serviceFeatures = b.serviceFeatures.filter((x) =>
        _SERVICE.has(String(x)),
      );
    }

    // Opening hours
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
            const open = val.open ?? "09:00";
            const close = val.close ?? "22:00";
            branch.openingHours[day] = `${open}-${close}`;
          }
        }
      }
    }

    // Contact
    if (b.contact && typeof b.contact === "object") {
      branch.contact = branch.contact || {};
      if (b.contact.email !== undefined)
        branch.contact.email = String(b.contact.email);
      if (b.contact.phone !== undefined)
        branch.contact.phone = String(b.contact.phone);
    }

    // Address
    if (b.address && typeof b.address === "object") {
      branch.address = branch.address || {};
      const a = b.address;
      if (a.addressLine !== undefined)
        branch.address.addressLine = String(a.addressLine);
      if (a.city !== undefined) branch.address.city = String(a.city);
      if (a.state !== undefined) branch.address.state = String(a.state);
      if (a.countryCode !== undefined)
        branch.address.countryCode = String(a.countryCode);
      if (a.mapPlaceId !== undefined)
        branch.address.mapPlaceId = a.mapPlaceId ? String(a.mapPlaceId) : null;

      if (a.coordinates && typeof a.coordinates === "object") {
        branch.address.coordinates = branch.address.coordinates || {};
        if (a.coordinates.lat !== undefined) {
          branch.address.coordinates.lat =
            a.coordinates.lat === null ? null : Number(a.coordinates.lat);
        }
        if (a.coordinates.lng !== undefined) {
          branch.address.coordinates.lng =
            a.coordinates.lng === null ? null : Number(a.coordinates.lng);
        }
      }
    }

    // Meta
    if (b.timeZone !== undefined) branch.timeZone = String(b.timeZone);
    if (b.currency !== undefined) branch.currency = String(b.currency);

    // Branding
    if (b.branding && typeof b.branding === "object") {
      branch.branding = branch.branding || {};
      if (b.branding.logo !== undefined)
        branch.branding.logo = b.branding.logo ? String(b.branding.logo) : null;
      if (b.branding.coverBannerLogo !== undefined) {
        branch.branding.coverBannerLogo = b.branding.coverBannerLogo
          ? String(b.branding.coverBannerLogo)
          : null;
      }
      if (b.branding.splashScreenEnabled !== undefined) {
        branch.branding.splashScreenEnabled = !!b.branding.splashScreenEnabled;
      }
    }

    // Taxes (safe parsing)
    if (b.taxes && typeof b.taxes === "object") {
      branch.taxes = branch.taxes || {};

      if (b.taxes.vatPercentage !== undefined) {
        const n = Number(b.taxes.vatPercentage);
        branch.taxes.vatPercentage = Number.isFinite(n) ? n : 0;
      }

      if (b.taxes.serviceChargePercentage !== undefined) {
        const n = Number(b.taxes.serviceChargePercentage);
        branch.taxes.serviceChargePercentage = Number.isFinite(n) ? n : 0;
      }

      if (b.taxes.isVatInclusive !== undefined) {
        branch.taxes.isVatInclusive = toBool(b.taxes.isVatInclusive);
      }

      if (b.taxes.showPlatformFee !== undefined) {
        branch.taxes.showPlatformFee = toBool(b.taxes.showPlatformFee);
      }

      if (b.taxes.platformFeePaidByCustomer !== undefined) {
        branch.taxes.platformFeePaidByCustomer = toBool(
          b.taxes.platformFeePaidByCustomer,
        );
      }

      // IMPORTANT: do not allow vendor to change platformFeePerOrder here
    }

    // QR Settings
    if (b.qrSettings && typeof b.qrSettings === "object") {
      branch.qrSettings = branch.qrSettings || {};
      if (b.qrSettings.qrsAllowed !== undefined)
        branch.qrSettings.qrsAllowed = !!b.qrSettings.qrsAllowed;
      if (b.qrSettings.noOfQrs !== undefined)
        branch.qrSettings.noOfQrs = Number(b.qrSettings.noOfQrs);
    }

    // Subscription
    if (b.subscription && typeof b.subscription === "object") {
      branch.subscription = branch.subscription || {};
      if (b.subscription.plan !== undefined)
        branch.subscription.plan = String(b.subscription.plan);
      if (b.subscription.expiryDate !== undefined) {
        branch.subscription.expiryDate = b.subscription.expiryDate
          ? new Date(b.subscription.expiryDate)
          : null;
      }
    }

    await branch.save();

    // bump menu stamp so customer cached view knows something changed
    await touchBranchMenuStampByBizId(branch.branchId);

    const updatedRaw = await Branch.findById(branch._id).lean();
    const updated = withStationBased(updatedRaw);

    return res.json({ message: "Branch updated", branch: updated });
  } catch (err) {
    console.error("updateBranchInformation error:", err);
    return res.status(500).json({ message: err.message });
  }
};

// -------------------- BRANCH MENU SECTIONS --------------------

// GET /api/branches/:branchId/menu/sections
export const getBranchMenuSections = async (req, res) => {
  try {
    const { branchId } = req.params;

    const branch = await loadBranchByPublicId(branchId);
    if (!branch) return res.status(404).json({ message: "Branch not found" });

    if (!(await ensureCanManageBranch(req, branch))) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const sections = [...(branch.menuSections || [])].sort(
      (a, b) =>
        (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
        a.nameEnglish.localeCompare(b.nameEnglish),
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

// POST /api/branches/:branchId/menu/sections
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
        return res
          .status(400)
          .json({ message: "Unknown key and nameEnglish is missing" });
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
      list[i].isEnabled = true;
      if (nameEnglish !== undefined) list[i].nameEnglish = nameEnglish;
      if (nameArabic !== undefined) list[i].nameArabic = nameArabic;
      if (sortOrder !== undefined) list[i].sortOrder = Number(sortOrder) || 0;
    } else {
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
    return res.status(created ? 201 : 200).json({
      message: created ? "Menu section enabled" : "Menu section updated",
      branchId: branch.branchId,
      section,
    });
  } catch (e) {
    console.error("upsertBranchMenuSection error:", e);
    return res.status(500).json({ message: e.message });
  }
};

// DELETE /api/branches/:branchId/menu/sections/:key?hard=true
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

export const getBranchCustomization = async (req, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ message: "Unauthorized" });

    const { branchId } = req.params;
    if (!branchId)
      return res.status(400).json({ message: "branchId is required" });

    const branch = await loadBranchByPublicId(branchId);
    if (!branch) return res.status(404).json({ message: "Branch not found" });

    if (!(await ensureCanManageBranch(req, branch))) {
      return res.status(403).json({ message: "Forbidden" });
    }

    // Ensure defaults if missing in older records
    const customization = branch.customization || { isClassicMenu: false };

    return res.json({
      message: "Customization fetched",
      buildTag: "customization-route-v1",
      branchId: branch.branchId,
      customization,
    });
  } catch (err) {
    console.error("getBranchCustomization error:", err);
    return res.status(500).json({ message: err.message });
  }
};

export const patchBranchCustomization = async (req, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ message: "Unauthorized" });

    const { branchId } = req.params;
    if (!branchId) {
      return res.status(400).json({ message: "branchId is required" });
    }

    const branch = await loadBranchByPublicId(branchId);
    if (!branch) return res.status(404).json({ message: "Branch not found" });

    if (!(await ensureCanManageBranch(req, branch))) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const body = req.body || {};
    const c =
      body.customization && typeof body.customization === "object"
        ? body.customization
        : null;

    if (!c) {
      return res
        .status(400)
        .json({ message: "customization object is required" });
    }

    // ✅ MUST use hasOwnProperty so "false" is not ignored
    const hasOwn = (obj, key) =>
      Object.prototype.hasOwnProperty.call(obj, key);

    const before = branch.customization?.isClassicMenu ?? false;

    // Ensure customization object exists
    if (!branch.customization) branch.customization = {};

    // ✅ Apply even if value is false
    if (hasOwn(c, "isClassicMenu")) {
      const next = toBool(c.isClassicMenu);
      branch.set("customization.isClassicMenu", next);
    } else {
      return res.status(400).json({
        message: "customization.isClassicMenu is required",
        buildTag: "customization-route-v2",
      });
    }

    // Force mongoose to treat it as modified
    branch.markModified("customization");

    await branch.save();
    await touchBranchMenuStampByBizId(branch.branchId);

    // Read fresh (by branchId) so you *see exactly what DB has*
    const fresh = await Branch.findOne({ branchId: branch.branchId }).lean();

    const after = fresh?.customization?.isClassicMenu ?? false;

    return res.json({
      message: "Customization updated",
      buildTag: "customization-route-v2",
      branchId: branch.branchId,
      before,
      after,
      customization: fresh?.customization ?? { isClassicMenu: false },
    });
  } catch (err) {
    console.error("patchBranchCustomization error:", err);
    return res.status(500).json({ message: err.message });
  }
};


// // import admin from "../config/firebase.js";
// // import Branch from "../models/Branch.js";
// // import Vendor from "../models/Vendor.js";
// // controllers/branchController.js
// import admin from "../config/firebase.js";
// import Branch from "../models/Branch.js";
// import Vendor from "../models/Vendor.js";
// import MenuType from "../models/MenuType.js";
// import { generateBranchId } from "../utils/generateBranchId.js";
// import { generatePublicSlug } from "../utils/generatePublicSlug.js";
// import { touchBranchMenuStampByBizId } from "../utils/touchMenuStamp.js";

// // NOTE: Make sure you have this somewhere in your project.
// // If you already have it in the old file, keep the same values.
// const _SERVICE = new Set([
//   "dineIn",
//   "takeAway",
//   "delivery",
//   "pickup",
//   "carHop",
//   "roomService",
// ]);

// async function generateUniquePublicSlug(maxTries = 12) {
//   for (let i = 0; i < maxTries; i++) {
//     const slug = generatePublicSlug();
//     const exists = await Branch.exists({ publicSlug: slug });
//     if (!exists) return slug;
//   }
//   throw new Error("Failed to generate unique publicSlug");
// }

// // -------------------- INTERNAL HELPERS --------------------

// const loadBranchByPublicId = async (branchId) => {
//   const branch = await Branch.findOne({ branchId }).lean(false); // real doc for save()
//   return branch;
// };

// const ensureCanManageBranch = async (req, branch) => {
//   const uid = req.user?.uid;
//   if (!uid || !branch) return false;

//   if (branch.userId === uid) return true;

//   const vendor = await Vendor.findOne({ vendorId: branch.vendorId }).lean();
//   if (vendor && vendor.userId === uid) return true;

//   return false;
// };

// const toBool = (v) => {
//   if (v === true || v === false) return v;
//   if (typeof v === "string") return v.toLowerCase() === "true";
//   if (typeof v === "number") return v === 1;
//   return false;
// };

// // -------------------- REGISTER BRANCH --------------------

// export const registerBranch = async (req, res) => {
//   try {
//     const {
//       token,
//       vendorId,
//       nameEnglish,
//       nameArabic,
//       venueType,
//       serviceFeatures,
//       openingHours,
//       contact,
//       address,
//       timeZone,
//       currency,
//       branding,
//       taxes,
//       qrSettings,

//       // optional from FE (plan only). expiryDate is controlled by backend
//       subscription,

//       // ✅ NEW: customization may come later, but for now backend forces default
//       customization,
//     } = req.body;

//     if (!token) {
//       return res.status(400).json({ message: "Firebase token required" });
//     }

//     // verify Firebase token
//     const decodedToken = await admin.auth().verifyIdToken(token);
//     const userId = decodedToken.uid;

//     // check vendor exists
//     const vendor = await Vendor.findOne({ vendorId }).lean();
//     if (!vendor) {
//       return res.status(404).json({ message: "Vendor not found" });
//     }

//     // generate branchId + slug
//     const branchId = await generateBranchId();
//     const publicSlug = await generateUniquePublicSlug();

//     // backend-controlled createdAt
//     const createdAt = new Date();

//     // 30 days trial
//     const trialDays = 30;
//     const expiryDate = new Date(
//       createdAt.getTime() + trialDays * 24 * 60 * 60 * 1000,
//     );

//     // plan: allow FE to send plan, otherwise default "trial"
//     const plan =
//       subscription && typeof subscription === "object" && subscription.plan
//         ? String(subscription.plan).trim()
//         : "trial";

//     // normalize taxes payload
//     const vatPct = taxes?.vatPercentage ?? vendor?.taxes?.vatPercentage ?? 0;
//     const svcPct = taxes?.serviceChargePercentage ?? 0;

//     const vatNumber =
//       (taxes?.vatNumber && String(taxes.vatNumber).trim()) ||
//       (vendor?.billing?.vatNumber && String(vendor.billing.vatNumber).trim()) ||
//       "";

//     const isVatInclusive =
//       taxes?.isVatInclusive !== undefined
//         ? !!taxes.isVatInclusive
//         : vendor?.taxes?.isVatInclusive !== undefined
//           ? !!vendor.taxes.isVatInclusive
//           : true;

//     // ✅ NEW: Force customization defaults on register
//     // (Even if FE sends something, you asked to default false for now)
//     const customizationObj = {
//       isClassicMenu: false,
//       // later you can add more keys here
//     };

//     // create branch
//     const branch = await Branch.create({
//       branchId,
//       publicSlug,
//       vendorId,
//       userId,
//       nameEnglish,
//       nameArabic,
//       venueType,

//       // serviceFeatures: if FE sends, allow only whitelisted keys
//       serviceFeatures: Array.isArray(serviceFeatures)
//         ? serviceFeatures.filter((x) => _SERVICE.has(String(x)))
//         : undefined,

//       openingHours,
//       contact,
//       address,
//       timeZone,
//       currency,
//       branding,
//       taxes: {
//         vatPercentage: Number(vatPct) || 0,
//         serviceChargePercentage: Number(svcPct) || 0,
//         vatNumber,
//         isVatInclusive,

//         platformFeePerOrder: null,
//         showPlatformFee: true,
//         platformFeePaidByCustomer: true,
//       },
//       qrSettings,

//       subscription: { plan, expiryDate },

//       // ✅ NEW
//       customization: customizationObj,

//       createdAt,
//       updatedAt: createdAt,
//     });

//     return res
//       .status(201)
//       .json({ message: "Branch registered successfully", branch });
//   } catch (error) {
//     console.error("Branch Register Error:", error);
//     return res.status(500).json({ message: error.message });
//   }
// };

// // -------------------- LIST BRANCHES --------------------

// export const listBranchesByVendor = async (req, res) => {
//   try {
//     const uid = req.user?.uid; // from verifyFirebaseToken
//     if (!uid) return res.status(401).json({ message: "Unauthorized" });

//     // Accept vendorId from /vendor/:vendorId or ?vendorId=
//     let vendorId = req.params.vendorId || req.query.vendorId;
//     // accept branchId as an exact match filter
//     const branchId = (req.query.branchId || "").toString().trim();

//     // Pagination
//     const page = Math.max(parseInt(req.query.page || "1", 10), 1);
//     const limit = Math.min(
//       Math.max(parseInt(req.query.limit || "20", 10), 1),
//       100,
//     );
//     const skip = (page - 1) * limit;

//     const status = req.query.status?.toString().trim();
//     const q = req.query.q?.toString().trim();

//     let baseFilter = {};
//     let resolvedVendorId = vendorId || null;

//     if (vendorId) {
//       const vendor = await Vendor.findOne({ vendorId }).lean();
//       if (!vendor) return res.status(404).json({ message: "Vendor not found" });

//       if (vendor.userId === uid) {
//         // Vendor owner → all branches in this vendor
//         baseFilter = { vendorId };
//       } else {
//         // Branch manager must own at least one branch in this vendor
//         const ownsAny = await Branch.exists({ vendorId, userId: uid });
//         if (!ownsAny) {
//           return res
//             .status(403)
//             .json({ message: "Forbidden: you do not own this vendor" });
//         }
//         baseFilter = { vendorId, userId: uid };
//       }
//     } else {
//       // Infer from user
//       const ownerVendor = await Vendor.findOne({ userId: uid }).lean();
//       if (ownerVendor) {
//         resolvedVendorId = ownerVendor.vendorId;
//         baseFilter = { vendorId: ownerVendor.vendorId };
//       } else {
//         // Branch manager across vendors
//         baseFilter = { userId: uid };
//       }
//     }

//     const filter = { ...baseFilter };

//     if (branchId) filter.branchId = branchId;
//     if (status) filter.status = status;

//     if (q) {
//       filter.$or = [
//         { branchId: { $regex: q, $options: "i" } },
//         { publicSlug: { $regex: q, $options: "i" } },
//         { nameEnglish: { $regex: q, $options: "i" } },
//         { nameArabic: { $regex: q, $options: "i" } },
//         { "address.city": { $regex: q, $options: "i" } },
//       ];
//     }

//     const [items, total] = await Promise.all([
//       Branch.find(filter)
//         .sort({ createdAt: -1 })
//         .skip(skip)
//         .limit(limit)
//         .lean(),
//       Branch.countDocuments(filter),
//     ]);

//     return res.json({
//       vendorId: resolvedVendorId,
//       page,
//       limit,
//       total,
//       totalPages: Math.ceil(total / limit),
//       items,
//     });
//   } catch (err) {
//     console.error("List branches error:", err);
//     return res.status(500).json({ message: err.message });
//   }
// };

// // -------------------- UPDATE BRANCH --------------------

// export const updateBranchInformation = async (req, res) => {
//   try {
//     const uid = req.user?.uid;
//     if (!uid) return res.status(401).json({ message: "Unauthorized" });

//     const { branchId } = req.params;
//     if (!branchId)
//       return res.status(400).json({ message: "branchId is required" });

//     const branch = await loadBranchByPublicId(branchId);
//     if (!branch) return res.status(404).json({ message: "Branch not found" });

//     if (!(await ensureCanManageBranch(req, branch))) {
//       return res.status(403).json({ message: "Forbidden" });
//     }

//     const b = req.body || {};

//     const _DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

//     // Basics
//     if (b.nameEnglish !== undefined) branch.nameEnglish = String(b.nameEnglish);
//     if (b.nameArabic !== undefined) branch.nameArabic = String(b.nameArabic);
//     if (b.venueType !== undefined) branch.venueType = String(b.venueType);
//     if (b.status !== undefined) branch.status = String(b.status);

//     // Service features
//     if (Array.isArray(b.serviceFeatures)) {
//       branch.serviceFeatures = b.serviceFeatures.filter((x) =>
//         _SERVICE.has(String(x)),
//       );
//     }

//     // Opening hours
//     if (b.openingHours && typeof b.openingHours === "object") {
//       branch.openingHours = branch.openingHours || {};
//       for (const [dayRaw, val] of Object.entries(b.openingHours)) {
//         const day = String(dayRaw || "").trim();
//         if (!_DAYS.includes(day)) continue;

//         if (typeof val === "string") {
//           branch.openingHours[day] = val;
//         } else if (val && typeof val === "object") {
//           if (val.closed === true) {
//             branch.openingHours[day] = "Closed";
//           } else {
//             const open = val.open ?? "09:00";
//             const close = val.close ?? "22:00";
//             branch.openingHours[day] = `${open}-${close}`;
//           }
//         }
//       }
//     }

//     // Contact
//     if (b.contact && typeof b.contact === "object") {
//       branch.contact = branch.contact || {};
//       if (b.contact.email !== undefined)
//         branch.contact.email = String(b.contact.email);
//       if (b.contact.phone !== undefined)
//         branch.contact.phone = String(b.contact.phone);
//     }

//     // Address
//     if (b.address && typeof b.address === "object") {
//       branch.address = branch.address || {};
//       const a = b.address;
//       if (a.addressLine !== undefined)
//         branch.address.addressLine = String(a.addressLine);
//       if (a.city !== undefined) branch.address.city = String(a.city);
//       if (a.state !== undefined) branch.address.state = String(a.state);
//       if (a.countryCode !== undefined)
//         branch.address.countryCode = String(a.countryCode);
//       if (a.mapPlaceId !== undefined)
//         branch.address.mapPlaceId = a.mapPlaceId ? String(a.mapPlaceId) : null;

//       if (a.coordinates && typeof a.coordinates === "object") {
//         branch.address.coordinates = branch.address.coordinates || {};
//         if (a.coordinates.lat !== undefined) {
//           branch.address.coordinates.lat =
//             a.coordinates.lat === null ? null : Number(a.coordinates.lat);
//         }
//         if (a.coordinates.lng !== undefined) {
//           branch.address.coordinates.lng =
//             a.coordinates.lng === null ? null : Number(a.coordinates.lng);
//         }
//       }
//     }

//     // Meta
//     if (b.timeZone !== undefined) branch.timeZone = String(b.timeZone);
//     if (b.currency !== undefined) branch.currency = String(b.currency);

//     // Branding
//     if (b.branding && typeof b.branding === "object") {
//       branch.branding = branch.branding || {};
//       if (b.branding.logo !== undefined)
//         branch.branding.logo = b.branding.logo ? String(b.branding.logo) : null;
//       if (b.branding.coverBannerLogo !== undefined) {
//         branch.branding.coverBannerLogo = b.branding.coverBannerLogo
//           ? String(b.branding.coverBannerLogo)
//           : null;
//       }
//       if (b.branding.splashScreenEnabled !== undefined) {
//         branch.branding.splashScreenEnabled = !!b.branding.splashScreenEnabled;
//       }
//     }

//     // Taxes (safe parsing)
//     if (b.taxes && typeof b.taxes === "object") {
//       branch.taxes = branch.taxes || {};

//       if (b.taxes.vatPercentage !== undefined) {
//         const n = Number(b.taxes.vatPercentage);
//         branch.taxes.vatPercentage = Number.isFinite(n) ? n : 0;
//       }

//       if (b.taxes.serviceChargePercentage !== undefined) {
//         const n = Number(b.taxes.serviceChargePercentage);
//         branch.taxes.serviceChargePercentage = Number.isFinite(n) ? n : 0;
//       }

//       if (b.taxes.isVatInclusive !== undefined) {
//         branch.taxes.isVatInclusive = toBool(b.taxes.isVatInclusive);
//       }

//       if (b.taxes.showPlatformFee !== undefined) {
//         branch.taxes.showPlatformFee = toBool(b.taxes.showPlatformFee);
//       }

//       if (b.taxes.platformFeePaidByCustomer !== undefined) {
//         branch.taxes.platformFeePaidByCustomer = toBool(
//           b.taxes.platformFeePaidByCustomer,
//         );
//       }

//       // IMPORTANT: do not allow vendor to change platformFeePerOrder here
//     }

//     // QR Settings
//     if (b.qrSettings && typeof b.qrSettings === "object") {
//       branch.qrSettings = branch.qrSettings || {};
//       if (b.qrSettings.qrsAllowed !== undefined)
//         branch.qrSettings.qrsAllowed = !!b.qrSettings.qrsAllowed;
//       if (b.qrSettings.noOfQrs !== undefined)
//         branch.qrSettings.noOfQrs = Number(b.qrSettings.noOfQrs);
//     }

//     // Subscription
//     if (b.subscription && typeof b.subscription === "object") {
//       branch.subscription = branch.subscription || {};
//       if (b.subscription.plan !== undefined)
//         branch.subscription.plan = String(b.subscription.plan);
//       if (b.subscription.expiryDate !== undefined) {
//         branch.subscription.expiryDate = b.subscription.expiryDate
//           ? new Date(b.subscription.expiryDate)
//           : null;
//       }
//     }

//     await branch.save();

//     // bump menu stamp so customer cached view knows something changed
//     await touchBranchMenuStampByBizId(branch.branchId);

//     const updated = await Branch.findById(branch._id).lean();

//     return res.json({ message: "Branch updated", branch: updated });
//   } catch (err) {
//     console.error("updateBranchInformation error:", err);
//     return res.status(500).json({ message: err.message });
//   }
// };

// // -------------------- BRANCH MENU SECTIONS --------------------

// // GET /api/branches/:branchId/menu/sections
// export const getBranchMenuSections = async (req, res) => {
//   try {
//     const { branchId } = req.params;

//     const branch = await loadBranchByPublicId(branchId);
//     if (!branch) return res.status(404).json({ message: "Branch not found" });

//     if (!(await ensureCanManageBranch(req, branch))) {
//       return res.status(403).json({ message: "Forbidden" });
//     }

//     const sections = [...(branch.menuSections || [])].sort(
//       (a, b) =>
//         (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
//         a.nameEnglish.localeCompare(b.nameEnglish),
//     );

//     return res.status(200).json({
//       branchId: branch.branchId,
//       vendorId: branch.vendorId,
//       sections,
//     });
//   } catch (e) {
//     console.error("getBranchMenuSections error:", e);
//     return res.status(500).json({ message: e.message });
//   }
// };

// // POST /api/branches/:branchId/menu/sections
// export const upsertBranchMenuSection = async (req, res) => {
//   try {
//     const { branchId } = req.params;
//     let { key, nameEnglish, nameArabic, sortOrder } = req.body || {};
//     if (!key) return res.status(400).json({ message: "key is required" });

//     key = String(key).toUpperCase().trim();

//     const branch = await loadBranchByPublicId(branchId);
//     if (!branch) return res.status(404).json({ message: "Branch not found" });

//     if (!(await ensureCanManageBranch(req, branch))) {
//       return res.status(403).json({ message: "Forbidden" });
//     }

//     // Default labels from MenuType if missing
//     if (!nameEnglish || !nameArabic) {
//       const mt = await MenuType.findOne({ key }).lean();
//       if (!mt && !nameEnglish) {
//         return res
//           .status(400)
//           .json({ message: "Unknown key and nameEnglish is missing" });
//       }
//       nameEnglish = nameEnglish ?? mt?.nameEnglish ?? key;
//       nameArabic = nameArabic ?? mt?.nameArabic ?? "";
//       if (sortOrder === undefined && mt?.sortOrder !== undefined) {
//         sortOrder = mt.sortOrder;
//       }
//     }

//     const list = branch.menuSections ?? [];
//     const i = list.findIndex((s) => s.key === key);

//     let created = false;
//     if (i >= 0) {
//       list[i].isEnabled = true;
//       if (nameEnglish !== undefined) list[i].nameEnglish = nameEnglish;
//       if (nameArabic !== undefined) list[i].nameArabic = nameArabic;
//       if (sortOrder !== undefined) list[i].sortOrder = Number(sortOrder) || 0;
//     } else {
//       list.push({
//         key,
//         nameEnglish,
//         nameArabic: nameArabic ?? "",
//         sortOrder: Number(sortOrder) || 0,
//         isEnabled: true,
//         itemCount: 0,
//       });
//       created = true;
//     }

//     branch.menuSections = list;
//     await branch.save();

//     const section = branch.menuSections.find((s) => s.key === key);
//     return res.status(created ? 201 : 200).json({
//       message: created ? "Menu section enabled" : "Menu section updated",
//       branchId: branch.branchId,
//       section,
//     });
//   } catch (e) {
//     console.error("upsertBranchMenuSection error:", e);
//     return res.status(500).json({ message: e.message });
//   }
// };

// // DELETE /api/branches/:branchId/menu/sections/:key?hard=true
// export const disableOrRemoveBranchMenuSection = async (req, res) => {
//   try {
//     const { branchId, key: rawKey } = req.params;
//     const hard = String(req.query.hard ?? "false").toLowerCase() === "true";
//     const key = String(rawKey).toUpperCase().trim();

//     const branch = await loadBranchByPublicId(branchId);
//     if (!branch) return res.status(404).json({ message: "Branch not found" });

//     if (!(await ensureCanManageBranch(req, branch))) {
//       return res.status(403).json({ message: "Forbidden" });
//     }

//     const list = branch.menuSections ?? [];
//     const i = list.findIndex((s) => s.key === key);
//     if (i < 0) return res.status(404).json({ message: "Section not found" });

//     if (hard) {
//       list.splice(i, 1);
//     } else {
//       list[i].isEnabled = false;
//     }

//     branch.menuSections = list;
//     await branch.save();

//     return res.status(200).json({
//       message: hard ? "Menu section removed" : "Menu section disabled",
//       branchId: branch.branchId,
//       key,
//     });
//   } catch (e) {
//     console.error("disableOrRemoveBranchMenuSection error:", e);
//     return res.status(500).json({ message: e.message });
//   }
// };

// export const getBranchCustomization = async (req, res) => {
//   try {
//     const uid = req.user?.uid;
//     if (!uid) return res.status(401).json({ message: "Unauthorized" });

//     const { branchId } = req.params;
//     if (!branchId)
//       return res.status(400).json({ message: "branchId is required" });

//     const branch = await loadBranchByPublicId(branchId);
//     if (!branch) return res.status(404).json({ message: "Branch not found" });

//     if (!(await ensureCanManageBranch(req, branch))) {
//       return res.status(403).json({ message: "Forbidden" });
//     }

//     // Ensure defaults if missing in older records
//     const customization = branch.customization || { isClassicMenu: false };

//     return res.json({
//       message: "Customization fetched",
//       buildTag: "customization-route-v1", // ✅ helps you confirm deployment
//       branchId: branch.branchId,
//       customization,
//     });
//   } catch (err) {
//     console.error("getBranchCustomization error:", err);
//     return res.status(500).json({ message: err.message });
//   }
// };

// export const patchBranchCustomization = async (req, res) => {
//   try {
//     const uid = req.user?.uid;
//     if (!uid) return res.status(401).json({ message: "Unauthorized" });

//     const { branchId } = req.params;
//     if (!branchId) {
//       return res.status(400).json({ message: "branchId is required" });
//     }

//     const branch = await loadBranchByPublicId(branchId);
//     if (!branch) return res.status(404).json({ message: "Branch not found" });

//     if (!(await ensureCanManageBranch(req, branch))) {
//       return res.status(403).json({ message: "Forbidden" });
//     }

//     const body = req.body || {};
//     const c =
//       body.customization && typeof body.customization === "object"
//         ? body.customization
//         : null;

//     if (!c) {
//       return res
//         .status(400)
//         .json({ message: "customization object is required" });
//     }

//     // ✅ MUST use hasOwnProperty so "false" is not ignored
//     const hasOwn = (obj, key) =>
//       Object.prototype.hasOwnProperty.call(obj, key);

//     const before = branch.customization?.isClassicMenu ?? false;

//     // Ensure customization object exists
//     if (!branch.customization) branch.customization = {};

//     // ✅ Apply even if value is false
//     if (hasOwn(c, "isClassicMenu")) {
//       const next = toBool(c.isClassicMenu);

//       // ALWAYS set when key exists (even if same) — avoids “false ignored” confusion
//       branch.set("customization.isClassicMenu", next);
//     } else {
//       return res.status(400).json({
//         message: "customization.isClassicMenu is required",
//         buildTag: "customization-route-v2",
//       });
//     }

//     // Force mongoose to treat it as modified
//     branch.markModified("customization");

//     await branch.save();
//     await touchBranchMenuStampByBizId(branch.branchId);

//     // Read fresh (by branchId) so you *see exactly what DB has*
//     const fresh = await Branch.findOne({ branchId: branch.branchId }).lean();

//     const after = fresh?.customization?.isClassicMenu ?? false;

//     return res.json({
//       message: "Customization updated",
//       buildTag: "customization-route-v2",
//       branchId: branch.branchId,
//       before,
//       after,
//       customization: fresh?.customization ?? { isClassicMenu: false },
//     });
//   } catch (err) {
//     console.error("patchBranchCustomization error:", err);
//     return res.status(500).json({ message: err.message });
//   }
// };