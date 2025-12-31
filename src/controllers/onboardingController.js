// src/controllers/onboardingController.js
import Vendor from "../models/Vendor.js";
import Branch from "../models/Branch.js";

// ✅ If you already have these helpers, use them.
// If you don't, keep reading below (I provide a clean utils file too).
import { generateVendorId, generateBranchId } from "../utils/generateVendorId.js";

function makeSlug(input = "") {
  return input
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9\-]/g, "")
    .replace(/\-+/g, "-")
    .replace(/^\-|\-$/g, "");
}

export const singleBranchOnboard = async (req, res) => {
  try {
    const businessName = (req.body.businessName || "").trim();
    if (!businessName) {
      return res.status(400).json({ error: "businessName is required" });
    }

    // from verifyFirebaseToken
    const uid = req.user?.uid;
    const email = req.user?.email || "";

    if (!uid) {
      return res.status(401).json({ error: "Unauthorized - Missing uid" });
    }

    // ✅ Idempotent: if vendor exists for this Firebase uid, return existing
    const existingVendor = await Vendor.findOne({ ownerUid: uid }).lean();
    if (existingVendor) {
      const existingBranch = await Branch.findOne({
        vendorId: existingVendor.vendorId,
      })
        .sort({ createdAt: 1 })
        .lean();

      return res.json({
        vendor: existingVendor,
        branch: existingBranch || null,
        existed: true,
      });
    }

    // 1) Create Vendor
    const vendorId = await generateVendorId(); // e.g. V000001
    const vendorDoc = await Vendor.create({
      vendorId,
      businessName,
      email,
      ownerUid: uid,
      isActive: true,
    });

    // 2) Create Branch (single branch: name = businessName)
    const branchId = await generateBranchId(); // e.g. BR-000001

    // slug is optional — safe even if schema doesn't have it
    const slug = makeSlug(`${businessName}-${branchId}`);

    const branchDoc = await Branch.create({
      vendorId: vendorId,
      branchId: branchId,
      nameEnglish: businessName,
      nameArabic: businessName,
      slug,
      menuSections: [],
      isActive: true,
    });

    return res.json({
      vendor: vendorDoc.toObject ? vendorDoc.toObject() : vendorDoc,
      branch: branchDoc.toObject ? branchDoc.toObject() : branchDoc,
      existed: false,
    });
  } catch (error) {
    console.error("[singleBranchOnboard] ERR:", error);
    return res.status(500).json({
      error: "Failed to onboard single-branch vendor",
      details: error?.message || String(error),
    });
  }
};
