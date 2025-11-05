// // controllers/vendorController.js
// import Vendor from "../models/Vendor.js";

// /**
//  * PATCH /api/vendor/profile
//  * Auth: Bearer Firebase ID token (verifyFirebaseToken sets req.user)
//  * Body: { businessName?, arabicbBusinessName?, contactPhone?, logoUrl? }
//  */
// export const updateMyVendor = async (req, res) => {
//   try {
//     const uid = req.user?.uid; // ← set by verifyFirebaseToken
//     if (!uid) return res.status(401).json({ message: "Unauthorized" });

//     const vendor = await Vendor.findOne({ userId: uid });
//     if (!vendor) return res.status(404).json({ message: "Vendor not found" });

//     const allow = ["businessName", "arabicbBusinessName", "contactPhone", "logoUrl"];
//     for (const k of allow) {
//       if (Object.prototype.hasOwnProperty.call(req.body, k)) {
//         vendor[k] = req.body[k];
//       }
//     }

//     await vendor.save();
//     return res.json({ message: "Vendor updated", vendor });
//   } catch (err) {
//     console.error("updateMyVendor error:", err);
//     return res.status(500).json({ message: err.message });
//   }
// };

// controllers/vendorController.js
import Vendor from "../models/Vendor.js";

/**
 * PATCH /api/vendor/profile
 * Auth: Bearer Firebase ID token (verifyFirebaseToken sets req.user)
 * Body can include:
 *  - businessName, arabicbBusinessName, contactPhone, logoUrl
 *  - billing: { vatNumber }
 *  - taxes: { vatPercentage }  // number (0..100)
 */
export const updateMyVendor = async (req, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ message: "Unauthorized" });

    const vendor = await Vendor.findOne({ userId: uid });
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    // flat fields
    const allow = ["businessName", "arabicbBusinessName", "contactPhone", "logoUrl"];
    for (const k of allow) {
      if (Object.prototype.hasOwnProperty.call(req.body, k)) {
        vendor[k] = req.body[k];
      }
    }

    // nested: billing.vatNumber
    if (req.body?.billing && Object.prototype.hasOwnProperty.call(req.body.billing, "vatNumber")) {
      const vn = req.body.billing.vatNumber;
      // allow clearing with null/empty string
      vendor.set("billing.vatNumber", (vn === null || vn === undefined || String(vn).trim() === "") ? undefined : String(vn).trim());
    }

    // nested: taxes.vatPercentage (0..100)
    if (req.body?.taxes && Object.prototype.hasOwnProperty.call(req.body.taxes, "vatPercentage")) {
      let v = req.body.taxes.vatPercentage;
      if (v === "" || v === null || v === undefined) {
        // allow clearing to undefined (remove the value)
        vendor.set("taxes.vatPercentage", undefined);
      } else {
        const num = Number(v);
        if (Number.isFinite(num)) {
          const bounded = Math.max(0, Math.min(100, num));
          vendor.set("taxes.vatPercentage", bounded);
        } else {
          return res.status(400).json({ message: "taxes.vatPercentage must be a number" });
        }
      }
    }

    await vendor.save();
    // return the updated vendor doc
    return res.json({ message: "Vendor updated", vendor });
  } catch (err) {
    console.error("updateMyVendor error:", err);
    return res.status(500).json({ message: err.message });
  }
};

