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

import Vendor from "../models/Vendor.js";

/**
 * PATCH /api/vendor/profile
 * Auth: Bearer Firebase ID token (verifyFirebaseToken sets req.user)
 *
 * Accepts (all optional):
 * {
 *   businessName, arabicbBusinessName, contactPhone, logoUrl,
 *   vatNumber,                       // or billing.vatNumber
 *   vatPercentage,                   // number 0..100
 *   serviceChargePercentage,         // number 0..100
 *   priceIncludesVat                 // boolean
 * }
 */
export const updateMyVendor = async (req, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ message: "Unauthorized" });

    const vendor = await Vendor.findOne({ userId: uid });
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    // Shallow fields
    const allow = ["businessName", "arabicbBusinessName", "contactPhone", "logoUrl"];
    for (const k of allow) {
      if (Object.prototype.hasOwnProperty.call(req.body, k)) {
        vendor[k] = req.body[k];
      }
    }

    // billing.vatNumber (accept flat or nested)
    if (Object.prototype.hasOwnProperty.call(req.body, "vatNumber")) {
      vendor.billing = vendor.billing || {};
      vendor.billing.vatNumber = req.body.vatNumber || "";
    }
    if (req.body?.billing && Object.prototype.hasOwnProperty.call(req.body.billing, "vatNumber")) {
      vendor.billing = vendor.billing || {};
      vendor.billing.vatNumber = req.body.billing.vatNumber || "";
    }

    // taxes
    const toNum = (v) => (v === "" || v === null || v === undefined ? undefined : Number(v));
    const clamp01 = (n) => (isNaN(n) ? undefined : Math.max(0, Math.min(100, n)));

    if (Object.prototype.hasOwnProperty.call(req.body, "vatPercentage")) {
      const n = clamp01(toNum(req.body.vatPercentage));
      if (n !== undefined) {
        vendor.taxes = vendor.taxes || {};
        vendor.taxes.vatPercentage = n;
      }
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "serviceChargePercentage")) {
      const n = clamp01(toNum(req.body.serviceChargePercentage));
      if (n !== undefined) {
        vendor.taxes = vendor.taxes || {};
        vendor.taxes.serviceChargePercentage = n;
      }
    }

    // settings.priceIncludesVat
    if (Object.prototype.hasOwnProperty.call(req.body, "priceIncludesVat")) {
      vendor.settings = vendor.settings || {};
      vendor.settings.priceIncludesVat = !!req.body.priceIncludesVat;
    }
    if (req.body?.settings && Object.prototype.hasOwnProperty.call(req.body.settings, "priceIncludesVat")) {
      vendor.settings = vendor.settings || {};
      vendor.settings.priceIncludesVat = !!req.body.settings.priceIncludesVat;
    }

    await vendor.save();
    return res.json({ message: "Vendor updated", vendor });
  } catch (err) {
    console.error("updateMyVendor error:", err);
    return res.status(500).json({ message: err.message });
  }
};
