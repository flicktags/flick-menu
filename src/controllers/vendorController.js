// controllers/vendorController.js
import Vendor from "../models/Vendor.js";

/**
 * PATCH /api/vendor/profile
 * Auth: Bearer Firebase ID token (verifyFirebaseToken sets req.user)
 * Body: { businessName?, arabicbBusinessName?, contactPhone?, logoUrl? }
 */
export const updateMyVendor = async (req, res) => {
  try {
    const uid = req.user?.uid; // ← set by verifyFirebaseToken
    if (!uid) return res.status(401).json({ message: "Unauthorized" });

    const vendor = await Vendor.findOne({ userId: uid });
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    const allow = ["businessName", "arabicbBusinessName", "contactPhone", "logoUrl"];
    for (const k of allow) {
      if (Object.prototype.hasOwnProperty.call(req.body, k)) {
        vendor[k] = req.body[k];
      }
    }

    await vendor.save();
    return res.json({ message: "Vendor updated", vendor });
  } catch (err) {
    console.error("updateMyVendor error:", err);
    return res.status(500).json({ message: err.message });
  }
};
