import admin from "../config/firebase.js";
import Branch from "../models/Branch.js";
import Vendor from "../models/Vendor.js";
import MenuType from "../models/MenuType.js"; // for default names on enable
import { generateBranchId } from "../utils/generateBranchId.js";

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

    // create branch
    const branch = await Branch.create({
      branchId,
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

export const listBranchesByVendor = async (req, res) => {
  try {
    const uid = req.user?.uid; // from verifyFirebaseToken
    if (!uid) return res.status(401).json({ message: "Unauthorized" });

    // vendorId can be passed or inferred from the authenticated user
    let vendorId = req.params.vendorId || req.query.vendorId;

    let vendor;
    if (vendorId) {
      vendor = await Vendor.findOne({ vendorId });
      if (!vendor) return res.status(404).json({ message: "Vendor not found" });
      if (vendor.userId !== uid) {
        return res.status(403).json({ message: "Forbidden: you do not own this vendor" });
      }
    } else {
      vendor = await Vendor.findOne({ userId: uid });
      if (!vendor) return res.status(404).json({ message: "No vendor found for this user" });
      vendorId = vendor.vendorId;
    }

    // Optional filters & pagination
    const page  = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10), 1), 100);
    const skip  = (page - 1) * limit;

    const status = req.query.status?.trim();
    const q      = req.query.q?.trim();

    const filter = { vendorId };
    if (status) filter.status = status;
    if (q) {
      filter.$or = [
        { branchId:        { $regex: q, $options: "i" } },
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
      vendorId,
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