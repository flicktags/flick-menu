import admin from "../config/firebase.js";
import Branch from "../models/Branch.js";
import Vendor from "../models/Vendor.js";
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