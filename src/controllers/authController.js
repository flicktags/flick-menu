// import admin from "../config/firebase.js";
// import Vendor from "../models/Vendor.js";
// import { generateVendorId } from "../utils/generateVendorId.js";

// export const registerVendor = async (req, res) => {
//   try {
//     const {
//       token,
//       businessName,
//       arabicbBusinessName,
//       contactPhone,
//       email,
//       country,
     
//       logoUrl,
//       billing,
    
//     } = req.body;

//     if (!token) {
//       return res.status(400).json({ message: "Firebase token required" });
//     }

//     // verify Firebase token
//     const decodedToken = await admin.auth().verifyIdToken(token);
//     const userId = decodedToken.uid;

//     // check if vendor already exists for this user
//     const existingVendor = await Vendor.findOne({ userId });
//     if (existingVendor) {
//       return res
//         .status(200)
//         .json({ message: "Vendor already registered", vendor: existingVendor });
//     }

//     // generate sequential VendorID
//     const vendorId = await generateVendorId();

//     // create new vendor
//     const vendor = await Vendor.create({
//       userId,
//       vendorId,
//       businessName,
//       arabicbBusinessName,

//       contactPhone,
//       email,
//       country,
//       logoUrl,
//       billing
      
//     })
//     res.status(201).json({ message: "Vendor registered successfully", vendor });
//   } catch (error) {
//     console.error("Vendor Register Error:", error);
//     res.status(500).json({ message: error.message });
//   }
// };
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

/** ========== AUTH BOOTSTRAP (vendor or branch) ==========
 * GET /api/auth/bootstrap
 * Headers: Authorization: Bearer <idToken>
 * Query:
 *   - mode: vendor | branch   (default vendor)
 *   - vendorId: required if mode=branch (to scope selection)
 *   - branchId: optional (to pin a specific branch)
 */
export const authBootstrap = async (req, res) => {
  try {
    const uid = req.user?.uid;
    const mode = String(req.query.mode || "vendor").toLowerCase();

    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    if (mode !== "branch") {
      // Vendor mode => same shape as /api/user/me
      const vendor = await Vendor.findOne({ userId: uid }).lean();
      return res.status(200).json({
        user: { uid: req.user.uid, email: req.user.email || null },
        vendor: vendor || null,
      });
    }

    // ---- Branch mode ----
    const vendorId = (req.query.vendorId || "").toString().trim();
    const branchId = (req.query.branchId || "").toString().trim();

    if (!vendorId) {
      return res.status(400).json({ error: "vendorId is required for branch mode" });
    }

    // Find branches owned by this user (branch manager), scoped to vendorId
    const filter = { userId: uid, vendorId };
    if (branchId) filter.branchId = branchId;

    const branches = await Branch.find(filter).lean();
    if (!branches || branches.length === 0) {
      return res.status(404).json({ error: "No branches found for this user/vendor selection" });
    }

    // Choose a primary branch (specific or first)
    const branch = branchId
      ? branches.find((b) => b.branchId === branchId) || branches[0]
      : branches[0];

    const vendor = await Vendor.findOne({ vendorId }).lean();

    return res.status(200).json({
      user: { uid: req.user.uid, email: req.user.email || null },
      vendor: vendor || null,      // may be null if not found; UI should handle
      branch,
      branches,
    });
  } catch (err) {
    console.error("authBootstrap error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};

