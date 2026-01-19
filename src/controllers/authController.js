// src/controllers/authController.js
import admin from "../config/firebase.js";
import Vendor from "../models/Vendor.js";
import Branch from "../models/Branch.js";           // ⬅️ add
import { generateVendorId } from "../utils/generateVendorId.js";

/** ========== VENDOR REGISTER (unchanged) ========== */
export const registerVendor = async (req, res) => {
  try {
    const {
      token,
      businessName,
      arabicbBusinessName,
      contactPhone,
      email,
      country,
      logoUrl,
      billing,
    } = req.body;

    if (!token) {
      return res.status(400).json({ message: "Firebase token required" });
    }

    // verify Firebase token
    const decodedToken = await admin.auth().verifyIdToken(token);
    const userId = decodedToken.uid;

    // check if vendor already exists for this user
    const existingVendor = await Vendor.findOne({ userId });
    if (existingVendor) {
      return res
        .status(200)
        .json({ message: "Vendor already registered", vendor: existingVendor });
    }

    // generate sequential VendorID
    const vendorId = await generateVendorId();

    // create new vendor
    const vendor = await Vendor.create({
      userId,
      vendorId,
      businessName,
      arabicbBusinessName,
      contactPhone,
      email,
      country,
      logoUrl,
      billing
    });

    res.status(201).json({ message: "Vendor registered successfully", vendor });
  } catch (error) {
    console.error("Vendor Register Error:", error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * GET /api/auth/bootstrap
 * Headers: Authorization: Bearer <idToken>
 * Query:
 *   - mode: vendor | branch (default vendor)
 *   - vendorId: OPTIONAL (for branch mode)
 *   - branchId: OPTIONAL (for branch mode)
 */
export const authBootstrap = async (req, res) => {
  try {
    const uid = req.user?.uid;
    const mode = String(req.query.mode || "vendor").toLowerCase();

    if (!uid) return res.status(401).json({ message: "Unauthorized" });

    // ---------------- Vendor mode ----------------
    if (mode !== "branch") {
      const vendor = await Vendor.findOne({ userId: uid }).lean();
      return res.status(200).json({
        user: { uid: req.user.uid, email: req.user.email || null },
        vendor: vendor || null,
      });
    }

    // ---------------- Branch mode ----------------
    const vendorIdQ = (req.query.vendorId || "").toString().trim(); // optional
    const branchIdQ = (req.query.branchId || "").toString().trim(); // optional

    // ✅ If vendorId is provided, keep your old behavior (backward compatible)
    if (vendorIdQ) {
      const filter = { userId: uid, vendorId: vendorIdQ };
      if (branchIdQ) filter.branchId = branchIdQ;

      const branches = await Branch.find(filter).sort({ createdAt: -1 }).lean();
      if (!branches.length) {
        return res.status(404).json({ message: "No branches found for this user/vendor selection" });
      }

      const branch = branchIdQ
        ? branches.find((b) => b.branchId === branchIdQ) || branches[0]
        : branches[0];

      const vendor = await Vendor.findOne({ vendorId: vendorIdQ }).lean();

      return res.status(200).json({
        user: { uid: req.user.uid, email: req.user.email || null },
        vendor: vendor || null,
        branch,
        branches,
      });
    }

    // ✅ NEW: No vendorId required — infer from branches owned by this UID
    const allBranches = await Branch.find({ userId: uid }).sort({ createdAt: -1 }).lean();
    if (!allBranches.length) {
      return res.status(404).json({ message: "No branches found for this user" });
    }

    // If branchId provided (optional), pin it
    let primary = allBranches[0];
    if (branchIdQ) {
      primary = allBranches.find((b) => b.branchId === branchIdQ) || allBranches[0];
    }

    // Infer vendorId from primary branch
    const inferredVendorId = (primary.vendorId || "").toString().trim();
    const vendor = inferredVendorId
      ? await Vendor.findOne({ vendorId: inferredVendorId }).lean()
      : null;

    return res.status(200).json({
      user: { uid: req.user.uid, email: req.user.email || null },
      vendor: vendor || null,
      branch: primary,
      branches: allBranches,
    });
  } catch (err) {
    console.error("authBootstrap error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};
