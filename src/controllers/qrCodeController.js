// src/controllers/qrCodeController.js
import admin from "../config/firebase.js";
import QRCode from "qrcode";
import QrCode from "../models/QrCodeOrders.js";
import Branch from "../models/Branch.js";
import Vendor from "../models/Vendor.js";
import { generateQrId } from "../utils/generateQrId.js";

/** Get Bearer token from Authorization header */
function getBearerToken(req) {
  const h = req.headers?.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

/**
 * POST /api/qrcode/generate
 * Body: { branchId: "BR-000004", type: "table"|"room", numberOfQrs: 5, label?: "Delux Room", token?: "<legacy>" }
 * - Auth: Prefer Authorization: Bearer <token>, fallback to body.token (for backward compat).
 * - Counter is BRANCH-WIDE: numeric suffix continues from Branch.qrGenerated.
 * - Uses atomic $inc to avoid overlaps under concurrency.
 */
const generateQr = async (req, res) => {
  try {
    // 1) Auth
    const bearer = getBearerToken(req);
    const token = bearer || req.body?.token; // keep body fallback for POST only
    if (!token) return res.status(400).json({ message: "Firebase token required" });

    const decoded = await admin.auth().verifyIdToken(token);
    const userId = decoded.uid;

    // 2) Inputs
    const branchBusinessId = String(req.body?.branchId || "").trim(); // e.g., "BR-000004"
    const typeRaw = String(req.body?.type || "").trim();
    const labelRaw = req.body?.label;
    const numberOfQrsRaw = req.body?.numberOfQrs;

    if (!branchBusinessId || !typeRaw || numberOfQrsRaw === undefined || numberOfQrsRaw === null) {
      return res.status(400).json({ message: "Missing required fields (branchId, type, numberOfQrs)" });
    }

    const count = parseInt(numberOfQrsRaw, 10);
    if (!Number.isFinite(count) || count <= 0) {
      return res.status(400).json({ message: "numberOfQrs must be a positive integer" });
    }

    // Normalize type: use lowercase for URL/number prefix, TitleCase for DB (matches enum ["Room","Table"])
    const typeLower = typeRaw.toLowerCase();
    if (!["table", "room"].includes(typeLower)) {
      return res.status(400).json({ message: 'type must be "table" or "room"' });
    }
    const typeStored = typeLower === "table" ? "Table" : "Room";
    const label = typeof labelRaw === "string" && labelRaw.trim().length > 0 ? labelRaw.trim() : undefined;

    // 3) Vendor by Firebase user
    const vendor = await Vendor.findOne({ userId }).lean();
    if (!vendor) return res.status(404).json({ message: "No vendor associated with this account" });

    // 4) Branch by business id (e.g., BR-000004)
    const branch = await Branch.findOne({ branchId: branchBusinessId }).lean();
    if (!branch) return res.status(404).json({ message: "Branch not found" });
    if (branch.vendorId !== vendor.vendorId) {
      return res.status(403).json({ message: "Branch does not belong to your vendor account" });
    }

    // 5) Limits
    const qrLimit = Number(branch.qrLimit ?? 0);
    const qrGenerated = Number(branch.qrGenerated ?? 0);
    const remaining = qrLimit - qrGenerated;
    if (count > remaining) {
      return res.status(400).json({
        message: `QR limit exceeded. You can only generate ${remaining} more QR codes.`,
        totalAllowed: qrLimit,
      });
    }

    // 6) Atomically reserve the next range on the branch-wide counter
    const prev = await Branch.findOneAndUpdate(
      { branchId: branchBusinessId },
      { $inc: { qrGenerated: count } },
      { new: false } // return previous doc so we know the starting number
    ).lean();

    if (!prev) return res.status(404).json({ message: "Branch not found (during update)" });

    const startIndex = Number(prev.qrGenerated ?? 0) + 1; // if 0 -> start from 1
    const baseUrl = "https://yourapp.com/lander";

    // 7) Create the QR docs
    const created = [];
    for (let i = 0; i < count; i++) {
      const suffix = startIndex + i;                 // 1..N (branch-wide)
      const qrId = await generateQrId();
      const qrNumber = `${typeLower}-${suffix}`;     // e.g., "table-7"

      const qrDataUrl =
        `${baseUrl}` +
        `?branch=${encodeURIComponent(branchBusinessId)}` +
        `&type=${encodeURIComponent(typeLower)}` +
        `&qrId=${encodeURIComponent(qrId)}` +
        `&number=${encodeURIComponent(qrNumber)}`;

      const qrImage = await QRCode.toDataURL(qrDataUrl);

      const doc = await QrCode.create({
        qrId,
        branchId: String(branch._id),                 // store Mongo _id as string (matches your current usage)
        vendorId: vendor.vendorId,
        type: typeStored,                             // "Table" or "Room" to satisfy enum
        label,
        number: qrNumber,                             // persisted number with prefix
        qrUrl: qrImage,
        active: true,
      });

      created.push({
        qrId: doc.qrId,
        branchId: doc.branchId,
        vendorId: doc.vendorId,
        type: doc.type,
        label: doc.label,
        number: doc.number,
        qrUrl: doc.qrUrl,
        active: doc.active,
        _id: doc._id,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        __v: doc.__v,
      });
    }

    // 8) Respond (do NOT add to qrGenerated again here)
    return res.status(201).json({
      message: "QR codes generated successfully",
      generated: created.length,
      startFrom: startIndex,
      qrs: created,
    });
  } catch (error) {
    console.error("QR Generate Error:", error);
    return res.status(500).json({ message: error.message });
  }
};

export default generateQr;

/**
 * GET /api/qrcode/branch/:branchId
 * - :branchId is the Mongo ObjectId string (e.g., "68e40176727a4e93b229efab")
 * - Auth: Authorization: Bearer <token>
 * - Returns QRs in ASCENDING order by numeric suffix (table-1, table-2, …).
 */
export const getBranchQrs = async (req, res) => {
  try {
    // 1) Auth
    const token = getBearerToken(req);
    if (!token) return res.status(400).json({ message: "Firebase token required" });

    const decoded = await admin.auth().verifyIdToken(token);
    const userId = decoded.uid;

    // 2) Vendor
    const vendor = await Vendor.findOne({ userId }).lean();
    if (!vendor) return res.status(404).json({ message: "No vendor associated with this account" });

    // 3) Branch ownership
    const branchObjectId = String(req.params?.branchId || "").trim();
    if (!branchObjectId) return res.status(400).json({ message: "branchId (Mongo _id) is required" });

    const branch = await Branch.findById(branchObjectId).lean();
    if (!branch) return res.status(404).json({ message: "Branch not found" });
    if (branch.vendorId !== vendor.vendorId) {
      return res.status(403).json({ message: "Branch does not belong to your vendor account" });
    }

    // 4) Fetch and sort ascending by numeric suffix in "number"
    const items = await QrCode.find({
      $and: [
        { $or: [{ branchId: branchObjectId }, { branchId: branch._id }] },
        { vendorId: vendor.vendorId },
      ],
    }).lean();

    const suffix = (numStr) => {
      const m = /(\d+)$/.exec(String(numStr || ""));
      return m ? parseInt(m[1], 10) : 0;
    };

    items.sort((a, b) => {
      // group by type (optional)
      const tA = String(a.type || "");
      const tB = String(b.type || "");
      if (tA !== tB) return tA.localeCompare(tB);
      // then numeric suffix
      const nA = suffix(a.number);
      const nB = suffix(b.number);
      if (nA !== nB) return nA - nB;
      // final fallback
      return String(a._id).localeCompare(String(b._id));
    });

    return res.status(200).json({
      branchObjectId,
      branchId: branch.branchId, // business id (e.g., BR-000004)
      vendorId: vendor.vendorId,
      total: items.length,
      items,
    });
  } catch (err) {
    console.error("QR List Error:", err);
    return res.status(500).json({ message: err.message });
  }
};




// import admin from "../config/firebase.js";
// import QRCode from "qrcode";
// import QrCode from "../models/QrCodeOrders.js";
// import Branch from "../models/Branch.js";
// import Vendor from "../models/Vendor.js";
// import { generateQrId } from "../utils/generateQrId.js";

// /** Get Bearer token from Authorization header */
// function getBearerToken(req) {
//   const h = req.headers?.authorization || "";
//   const m = /^Bearer\s+(.+)$/i.exec(h);
//   return m ? m[1] : null;
// }

// /**
//  * POST /api/qrcode/generate
//  * Body: { branchId: "BR-000004", type: "table"|"room", numberOfQrs: 5, label?: "Delux Room", token?: "<legacy>" }
//  * - Auth: Prefer Authorization: Bearer <token>, fallback to body.token (for backward compat).
//  * - Counter is BRANCH-WIDE: numeric suffix continues from Branch.qrGenerated.
//  * - Uses atomic $inc to avoid overlaps under concurrency.
//  */
// c = async (req, res) => {
//   try {
//     // 1) Auth
//     const bearer = getBearerToken(req);
//     const token = bearer || req.body?.token; // keep body fallback for POST only
//     if (!token) {
//       return res.status(400).json({ message: "Firebase token required" });
//     }
//     const decoded = await admin.auth().verifyIdToken(token);
//     const userId = decoded.uid;

//     // 2) Inputs
//     const branchBusinessId = String(req.body?.branchId || "").trim(); // e.g., "BR-000004"
//     const typeRaw = String(req.body?.type || "").trim();
//     const labelRaw = req.body?.label;
//     const numberOfQrsRaw = req.body?.numberOfQrs;

//     if (!branchBusinessId || !typeRaw || numberOfQrsRaw === undefined || numberOfQrsRaw === null) {
//       return res.status(400).json({ message: "Missing required fields (branchId, type, numberOfQrs)" });
//     }

//     const count = parseInt(numberOfQrsRaw, 10);
//     if (!Number.isFinite(count) || count <= 0) {
//       return res.status(400).json({ message: "numberOfQrs must be a positive integer" });
//     }

//     // normalize type to lowercase for storage/number prefix
//     const type = typeRaw.toLowerCase();
//     if (!["table", "room"].includes(type)) {
//       return res.status(400).json({ message: 'type must be "table" or "room"' });
//     }
//     const label = typeof labelRaw === "string" && labelRaw.trim().length > 0 ? labelRaw.trim() : undefined;

//     // 3) Vendor by Firebase user
//     const vendor = await Vendor.findOne({ userId }).lean();
//     if (!vendor) {
//       return res.status(404).json({ message: "No vendor associated with this account" });
//     }

//     // 4) Branch by business id (e.g., BR-000004)
//     const branch = await Branch.findOne({ branchId: branchBusinessId }).lean();
//     if (!branch) {
//       return res.status(404).json({ message: "Branch not found" });
//     }
//     if (branch.vendorId !== vendor.vendorId) {
//       return res.status(403).json({ message: "Branch does not belong to your vendor account" });
//     }

//     // 5) Check limits
//     const qrLimit = Number(branch.qrLimit ?? 0);
//     const qrGenerated = Number(branch.qrGenerated ?? 0);
//     const remaining = qrLimit - qrGenerated;
//     if (count > remaining) {
//       return res.status(400).json({
//         message: `QR limit exceeded. You can only generate ${remaining} more QR codes.`,
//         totalAllowed: qrLimit,
//       });
//     }

//     // 6) Atomically reserve the next range on the branch-wide counter
//     const prev = await Branch.findOneAndUpdate(
//       { branchId: branchBusinessId },
//       { $inc: { qrGenerated: count } },
//       { new: false } // return the previous doc (so we know the starting number)
//     ).lean();

//     if (!prev) {
//       return res.status(404).json({ message: "Branch not found (during update)" });
//     }

//     const startIndex = Number(prev.qrGenerated ?? 0) + 1; // if 0 -> start from 1
//     const baseUrl = "https://yourapp.com/order";

//     // 7) Create the QR docs
//     const created = [];
//     for (let i = 0; i < count; i++) {
//       const suffix = startIndex + i;               // 1..N (branch-wide)
//       const qrId = await generateQrId();
//       // const qrDataUrl = `${baseUrl}?branch=${encodeURIComponent(branchBusinessId)}&type=${encodeURIComponent(type)}&qrId=${encodeURIComponent(qrId)}`;
      
//       const qrImage = await QRCode.toDataURL(qrDataUrl);

//       const doc = await QrCode.create({
//         qrId,
//         branchId: String(branch._id),              // store Mongo _id as string (matches your current usage)
//         vendorId: vendor.vendorId,
//         type,                                      // store normalized lowercase
//         label,
//         number: `${type}-${suffix}`,
//         qrUrl: qrImage,
//         active: true,
//       });

//       created.push({
//         qrId: doc.qrId,
//         branchId: doc.branchId,
//         vendorId: doc.vendorId,
//         type: doc.type,
//         label: doc.label,
//         number: doc.number,
//         qrUrl: doc.qrUrl,
//         active: doc.active,
//         _id: doc._id,
//         createdAt: doc.createdAt,
//         updatedAt: doc.updatedAt,
//         __v: doc.__v,
//       });
//     }

//     // 8) Respond (DO NOT add to qrGenerated again here)
//     return res.status(201).json({
//       message: "QR codes generated successfully",
//       generated: created.length,
//       startFrom: startIndex,
//       qrs: created,
//     });
//   } catch (error) {
//     console.error("QR Generate Error:", error);
//     return res.status(500).json({ message: error.message });
//   }
// };

// export default generateQr;

// /**
//  * GET /api/qrcode/branch/:branchId
//  * - :branchId is the Mongo ObjectId string (e.g., "68e40176727a4e93b229efab")
//  * - Auth: Authorization: Bearer <token> (no query/body token)
//  * - Returns QRs in ASCENDING order (table-1 ... table-N).
//  */
// export const getBranchQrs = async (req, res) => {
//   try {
//     // 1) Auth (header only, per your requirement)
//     const token = getBearerToken(req);
//     if (!token) return res.status(400).json({ message: "Firebase token required" });

//     const decoded = await admin.auth().verifyIdToken(token);
//     const userId = decoded.uid;

//     // 2) Vendor
//     const vendor = await Vendor.findOne({ userId }).lean();
//     if (!vendor) return res.status(404).json({ message: "No vendor associated with this account" });

//     // 3) Branch ownership
//     const branchObjectId = String(req.params?.branchId || "").trim();
//     if (!branchObjectId) return res.status(400).json({ message: "branchId (Mongo _id) is required" });

//     const branch = await Branch.findById(branchObjectId).lean();
//     if (!branch) return res.status(404).json({ message: "Branch not found" });
//     if (branch.vendorId !== vendor.vendorId) {
//       return res.status(403).json({ message: "Branch does not belong to your vendor account" });
//     }

//     // 4) Fetch all QRs for that branch (handle both string/ObjId storage)
//     const items = await QrCode.find({
//       $and: [
//         { $or: [{ branchId: branchObjectId }, { branchId: branch._id }] },
//         { vendorId: vendor.vendorId },
//       ],
//     })
//       // Ascending order so you'll see table-1 ... table-5
//       .sort({ createdAt: 1, _id: 1 })
//       .lean();

//     return res.status(200).json({
//       branchObjectId,
//       branchId: branch.branchId,     // business id (BR-000004)
//       vendorId: vendor.vendorId,
//       total: items.length,
//       items,
//     });
//   } catch (err) {
//     console.error("QR List Error:", err);
//     return res.status(500).json({ message: err.message });
//   }
// };