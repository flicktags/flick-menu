import admin from "../config/firebase.js";
import Vendor from "../models/Vendor.js";
import { generateVendorId } from "../utils/generateVendorId.js";

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
      
    })
    res.status(201).json({ message: "Vendor registered successfully", vendor });
  } catch (error) {
    console.error("Vendor Register Error:", error);
    res.status(500).json({ message: error.message });
  }
};
export const authBootstrap = async (req, res) => {
  try {
    const uid = req.user?.uid;
    const mode = String(req.query.mode || "vendor").toLowerCase();

    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    if (mode !== "branch") {
      // Fallback: return same as /api/user/me to keep things predictable
      const vendor = await Vendor.findOne({ userId: uid }).lean();
      return res.status(200).json({
        user: { uid: req.user.uid, email: req.user.email || null },
        vendor: vendor || null,
      });
    }

    // ---- Branch mode ----
    const vendorId = (req.query.vendorId || "").toString().trim();
    const branchId = (req.query.branchId || "").toString().trim();

    // Find all branches owned by this UID (branch managers)
    const filter = { userId: uid };
    if (vendorId) filter.vendorId = vendorId;
    if (branchId) filter.branchId = branchId;

    const branches = await Branch.find(filter).lean();
    if (!branches || branches.length === 0) {
      return res.status(404).json({ error: "No branches found for this user/vendor selection" });
    }

    // Pick a primary branch (first or specific one)
    const branch = branchId
      ? branches.find((b) => b.branchId === branchId) || branches[0]
      : branches[0];

    // Load the vendor for context
    const vId = branch?.vendorId || vendorId || null;
    const vendor = vId ? await Vendor.findOne({ vendorId: vId }).lean() : null;

    return res.status(200).json({
      user: { uid: req.user.uid, email: req.user.email || null },
      vendor: vendor || null,          // may be null if not found; frontend should handle
      branch: branch,                  // primary branch
      branches: branches,              // all owned branches (if multiple)
    });
  } catch (err) {
    console.error("authBootstrap error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};