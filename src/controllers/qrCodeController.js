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

/** numeric suffix helper: "table-12" -> 12  (fallback -Infinity if none) */
function suffixOf(numStr) {
  const m = /(\d+)$/.exec(String(numStr || ""));
  return m ? parseInt(m[1], 10) : -Infinity;
}

/**
 * POST /api/qrcode/generate
 * Body: { branchId: "BR-000004", type: "table"|"room", numberOfQrs: 5, label?: "Delux Room", token?: "<legacy>" }
 * - Auth: Prefer Authorization: Bearer <token>, fallback to body.token (for backward compat).
 * - **Per-type** counters: qrGeneratedTable / qrGeneratedRoom (atomic $inc).
 * - Total counter: qrGenerated (atomic $inc) to enforce overall limit.
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

    // Normalize type for URL/number, TitleCase for response if your schema allows it
    const typeLower = typeRaw.toLowerCase();
    if (!["table", "room"].includes(typeLower)) {
      return res.status(400).json({ message: 'type must be "table" or "room"' });
    }
    const typeStored = typeLower === "table" ? "Table" : "Room"; // <-- keep if schema allows TitleCase
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

    // 5) Enforce overall limit atomically
    //    Use $expr to ensure qrGenerated + count <= qrLimit in the same op.
    const incField = typeLower === "table" ? "qrGeneratedTable" : "qrGeneratedRoom";
    const filter = {
      branchId: branchBusinessId,
      $expr: { $lte: [{ $add: ["$qrGenerated", count] }, "$qrLimit"] },
    };

    const prev = await Branch.findOneAndUpdate(
      filter,
      { $inc: { qrGenerated: count, [incField]: count } },
      { new: false } // get previous values, we will derive start from prev[incField]
    ).lean();

    if (!prev) {
      // Either branch not found by businessId or limit exceeded under concurrency
      return res.status(400).json({
        message: "QR limit exceeded or branch not found (concurrent request). Please try a smaller count.",
      });
    }

    // 6) Compute start index for THIS type.
    //    If this is the first time we add the type counter, backfill from DB max(number) for that type.
    let prevTypeCounter = Number(prev?.[incField]);
    if (!Number.isFinite(prevTypeCounter)) {
      // field didn't exist on prev doc -> backfill from existing rows of that type
      const lastOfType = await QrCode.find({
        $and: [
          { $or: [{ branchId: String(branch._id) }, { branchId: branch._id }] },
          { vendorId: vendor.vendorId },
          { type: { $in: [typeStored, typeLower] } },
        ],
      })
        .select("number")
        .sort({ createdAt: -1, _id: -1 })
        .limit(1)
        .lean();

      const maxSuffix = suffixOf(lastOfType?.[0]?.number);
      prevTypeCounter = Number.isFinite(maxSuffix) ? Math.max(0, maxSuffix) : 0;
    }

    const startIndex = prevTypeCounter + 1;
    const baseUrl = "https://yourapp.com/lander";

    // 7) Create the QR docs
    const created = [];
    for (let i = 0; i < count; i++) {
      const suffix = startIndex + i;                    // per-type 1..N
      const qrId = await generateQrId();
      const qrNumber = `${typeLower}-${suffix}`;        // e.g., "table-9"

      const qrDataUrl =
        `${baseUrl}` +
        `?branch=${encodeURIComponent(branchBusinessId)}` +
        `&type=${encodeURIComponent(typeLower)}` +
        `&qrId=${encodeURIComponent(qrId)}` +
        `&number=${encodeURIComponent(qrNumber)}`;

      const qrImage = await QRCode.toDataURL(qrDataUrl);

      const doc = await QrCode.create({
        qrId,
        branchId: String(branch._id), // store Mongo _id as string
        vendorId: vendor.vendorId,
        type: typeStored,             // "Table" | "Room" (if schema forces lowercase, change here)
        label,
        number: qrNumber,
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
 * - Returns QRs in ASCENDING order by type then numeric suffix (table-1, table-2, …).
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

    // 4) Fetch and sort ascending by type then numeric suffix
    const items = await QrCode.find({
      $and: [
        { $or: [{ branchId: branchObjectId }, { branchId: branch._id }] },
        { vendorId: vendor.vendorId },
      ],
    }).lean();

    items.sort((a, b) => {
      const tA = String(a.type || "");
      const tB = String(b.type || "");
      if (tA !== tB) return tA.localeCompare(tB);
      const nA = suffixOf(a.number);
      const nB = suffixOf(b.number);
      if (nA !== nB) return nA - nB;
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

/**
 * POST /api/qrcode/branch/:branchId/delete-latest
 * Body: { type: "table"|"room", count: 3 }
 * - Deletes from the **top** (highest suffix first) within the chosen type only.
 * - Decrements BOTH total (qrGenerated) and the per-type counter.
 */
export const deleteLatestQrs = async (req, res) => {
  try {
    // 1) Auth
    const token = getBearerToken(req);
    if (!token) return res.status(400).json({ message: "Firebase token required" });

    const decoded = await admin.auth().verifyIdToken(token);
    const userId = decoded.uid;

    // 2) Inputs
    const branchObjectId = String(req.params?.branchId || "").trim();   // Mongo _id of branch
    const rawType = String(req.body?.type || "").trim().toLowerCase();  // "table" | "room"
    const rawCount = req.body?.count;

    if (!branchObjectId) return res.status(400).json({ message: "branchId (Mongo _id) is required" });
    if (!["table", "room"].includes(rawType)) {
      return res.status(400).json({ message: 'type must be "table" or "room"' });
    }

    const count = parseInt(rawCount, 10);
    if (!Number.isFinite(count) || count <= 0) {
      return res.status(400).json({ message: "count must be a positive integer" });
    }

    // 3) Vendor
    const vendor = await Vendor.findOne({ userId }).lean();
    if (!vendor) return res.status(404).json({ message: "No vendor associated with this account" });

    // 4) Branch & ownership
    const branch = await Branch.findById(branchObjectId).lean();
    if (!branch) return res.status(404).json({ message: "Branch not found" });
    if (branch.vendorId !== vendor.vendorId) {
      return res.status(403).json({ message: "Branch does not belong to your vendor account" });
    }

    // 5) "Room"/"Table" may exist in DB, also older lowercase. Match both.
    const typeCandidates = [rawType, rawType.charAt(0).toUpperCase() + rawType.slice(1)];

    // 6) Get all QRs for that branch + type; sort by numeric suffix DESC (top/backward)
    const candidates = await QrCode.find({
      $and: [
        { $or: [{ branchId: branchObjectId }, { branchId: branch._id }] },
        { vendorId: vendor.vendorId },
        { type: { $in: typeCandidates } },
      ],
    })
      .select("_id number type")
      .lean();

    if (!candidates.length) {
      return res.status(200).json({
        message: `No QRs found for type "${rawType}" on this branch.`,
        deleted: 0,
        deletedNumbers: [],
        newQrGenerated: branch.qrGenerated ?? 0,
      });
    }

    candidates.sort((a, b) => suffixOf(b.number) - suffixOf(a.number));
    const toDelete = candidates.slice(0, Math.min(count, candidates.length));
    const ids = toDelete.map(d => d._id);
    const deletedNumbers = toDelete.map(d => String(d.number || ""));

    if (ids.length === 0) {
      return res.status(200).json({
        message: `Nothing to delete for type "${rawType}".`,
        deleted: 0,
        deletedNumbers: [],
        newQrGenerated: branch.qrGenerated ?? 0,
      });
    }

    // 7) Delete selected docs
    const delRes = await QrCode.deleteMany({ _id: { $in: ids } });
    const actuallyDeleted = delRes?.deletedCount || 0;

    // 8) Decrement counters (total and per-type), clamped to >= 0
    const incField = rawType === "table" ? "qrGeneratedTable" : "qrGeneratedRoom";
    if (actuallyDeleted > 0) {
      const fresh = await Branch.findById(branch._id, "qrGenerated qrGeneratedTable qrGeneratedRoom").lean();
      const currentTotal = Number(fresh?.qrGenerated ?? 0);
      const currentType  = Number(fresh?.[incField] ?? 0);
      const nextTotal = Math.max(0, currentTotal - actuallyDeleted);
      const nextType  = Math.max(0, currentType - actuallyDeleted);
      await Branch.findByIdAndUpdate(branch._id, { $set: { qrGenerated: nextTotal, [incField]: nextType } });
    }

    const after = await Branch.findById(branch._id, "qrGenerated").lean();

    return res.status(200).json({
      message: `Deleted ${actuallyDeleted} ${rawType} QR(s) from the top.`,
      type: rawType === "table" ? "Table" : "Room",
      deleted: actuallyDeleted,
      deletedNumbers, // e.g. ["table-11", "table-10", ...]
      newQrGenerated: Number(after?.qrGenerated ?? 0),
    });
  } catch (err) {
    console.error("QR Delete Error:", err);
    return res.status(500).json({ message: err.message });
  }
};



// // src/controllers/qrCodeController.js
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

// /** Extract numeric suffix from "...-123" (used for sorting) */
// function suffixOf(numStr) {
//   const m = /(\d+)$/.exec(String(numStr || ""));
//   return m ? parseInt(m[1], 10) : -Infinity;
// }

// /** "table"|"room" -> "Table"|"Room" (for responses) */
// function toTitleType(t) {
//   const s = String(t || "").toLowerCase();
//   return s === "table" ? "Table" : s === "room" ? "Room" : s;
// }

// /**
//  * POST /api/qrcode/generate
//  * Body: { branchId: "BR-000004", type: "table"|"room", numberOfQrs: 5, label?: "Delux Room", token?: "<legacy>" }
//  * - Auth: Bearer (header) preferred; falls back to body.token for backward compat.
//  * - Branch-wide counter via atomic $inc on Branch.qrGenerated.
//  * - DB stores type in lowercase (schema enum ["room","table"]); API responses return TitleCase.
//  */
// const generateQr = async (req, res) => {
//   try {
//     // 1) Auth
//     const bearer = getBearerToken(req);
//     const token = bearer || req.body?.token; // keep body fallback for POST only
//     if (!token) return res.status(400).json({ message: "Firebase token required" });

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

//     // Normalize type to lowercase for DB
//     const typeLower = typeRaw.toLowerCase();
//     if (!["table", "room"].includes(typeLower)) {
//       return res.status(400).json({ message: 'type must be "table" or "room"' });
//     }
//     const typeTitle = toTitleType(typeLower);
//     const label = typeof labelRaw === "string" && labelRaw.trim().length > 0 ? labelRaw.trim() : undefined;

//     // 3) Vendor by Firebase user
//     const vendor = await Vendor.findOne({ userId }).lean();
//     if (!vendor) return res.status(404).json({ message: "No vendor associated with this account" });

//     // 4) Branch by business id (e.g., BR-000004)
//     const branch = await Branch.findOne({ branchId: branchBusinessId }).lean();
//     if (!branch) return res.status(404).json({ message: "Branch not found" });
//     if (branch.vendorId !== vendor.vendorId) {
//       return res.status(403).json({ message: "Branch does not belong to your vendor account" });
//     }

//     // 5) Limits
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
//       { new: false } // return previous doc so we know the starting number
//     ).lean();

//     if (!prev) return res.status(404).json({ message: "Branch not found (during update)" });

//     const startIndex = Number(prev.qrGenerated ?? 0) + 1; // if 0 -> start from 1
//     const baseUrl = "https://yourapp.com/lander";

//     // 7) Create the QR docs
//     const created = [];
//     for (let i = 0; i < count; i++) {
//       const suffix = startIndex + i;                 // 1..N (branch-wide)
//       const qrId = await generateQrId();
//       const qrNumber = `${typeLower}-${suffix}`;     // e.g., "table-7"

//       const qrDataUrl =
//         `${baseUrl}` +
//         `?branch=${encodeURIComponent(branchBusinessId)}` +
//         `&type=${encodeURIComponent(typeLower)}` +
//         `&qrId=${encodeURIComponent(qrId)}` +
//         `&number=${encodeURIComponent(qrNumber)}`;

//       const qrImage = await QRCode.toDataURL(qrDataUrl);

//       const doc = await QrCode.create({
//         qrId,
//         branchId: String(branch._id),                 // store Mongo _id as string (matches your current usage)
//         vendorId: vendor.vendorId,
//         type: typeLower,                              // DB expects lowercase per schema
//         label,
//         number: qrNumber,
//         qrUrl: qrImage,
//         active: true,
//       });

//       // Respond with TitleCase type
//       created.push({
//         qrId: doc.qrId,
//         branchId: doc.branchId,
//         vendorId: doc.vendorId,
//         type: toTitleType(doc.type),
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

//     // 8) Respond (do NOT add to qrGenerated again here)
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

// /**
//  * GET /api/qrcode/branch/:branchId
//  * - :branchId is the Mongo ObjectId string (e.g., "68e40176727a4e93b229efab")
//  * - Auth: Authorization: Bearer <token>
//  * - Returns QRs in ASCENDING order by numeric suffix (table-1, table-2, …).
//  * - Returns type as "Table"/"Room".
//  */
// const getBranchQrs = async (req, res) => {
//   try {
//     // 1) Auth
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

//     // 4) Fetch and sort ascending by numeric suffix in "number"
//     const raw = await QrCode.find({
//       $and: [
//         { $or: [{ branchId: branchObjectId }, { branchId: branch._id }] },
//         { vendorId: vendor.vendorId },
//       ],
//     }).lean();

//     raw.sort((a, b) => {
//       // group by type for stability (optional)
//       const tA = String(a.type || "");
//       const tB = String(b.type || "");
//       if (tA !== tB) return tA.localeCompare(tB);
//       // then numeric suffix
//       const nA = suffixOf(a.number);
//       const nB = suffixOf(b.number);
//       if (nA !== nB) return nA - nB;
//       // final fallback
//       return String(a._id).localeCompare(String(b._id));
//     });

//     // Map to response with TitleCase type
//     const items = raw.map(d => ({
//       ...d,
//       type: toTitleType(d.type),
//     }));

//     return res.status(200).json({
//       branchObjectId,
//       branchId: branch.branchId, // business id (e.g., BR-000004)
//       vendorId: vendor.vendorId,
//       total: items.length,
//       items,
//     });
//   } catch (err) {
//     console.error("QR List Error:", err);
//     return res.status(500).json({ message: err.message });
//   }
// };

// /**
//  * POST /api/qrcode/branch/:branchId/delete-latest
//  * Body: { type: "table"|"room", count: number }
//  * - Deletes the latest `count` QRs for that type (highest numeric suffix) on that branch.
//  * - Only the specified type is affected.
//  * - Decrements Branch.qrGenerated by the actual deleted count (clamped at 0).
//  * - Returns type as "Table"/"Room".
//  */
// const deleteLatestQrs = async (req, res) => {
//   try {
//     // 1) Auth
//     const token = getBearerToken(req);
//     if (!token) return res.status(400).json({ message: "Firebase token required" });

//     const decoded = await admin.auth().verifyIdToken(token);
//     const userId = decoded.uid;

//     // 2) Inputs
//     const branchObjectId = String(req.params?.branchId || "").trim();   // Mongo _id of branch
//     const rawType = String(req.body?.type || "").trim().toLowerCase();  // "table" | "room"
//     const rawCount = req.body?.count;

//     if (!branchObjectId) return res.status(400).json({ message: "branchId (Mongo _id) is required" });
//     if (!["table", "room"].includes(rawType)) {
//       return res.status(400).json({ message: 'type must be "table" or "room"' });
//     }

//     const count = parseInt(rawCount, 10);
//     if (!Number.isFinite(count) || count <= 0) {
//       return res.status(400).json({ message: "count must be a positive integer" });
//     }

//     // 3) Vendor
//     const vendor = await Vendor.findOne({ userId }).lean();
//     if (!vendor) return res.status(404).json({ message: "No vendor associated with this account" });

//     // 4) Branch & ownership
//     const branch = await Branch.findById(branchObjectId).lean();
//     if (!branch) return res.status(404).json({ message: "Branch not found" });
//     if (branch.vendorId !== vendor.vendorId) {
//       return res.status(403).json({ message: "Branch does not belong to your vendor account" });
//     }

//     // 5) Match type (support legacy rows that may have TitleCase)
//     const typeCandidates = [rawType, rawType.charAt(0).toUpperCase() + rawType.slice(1)];

//     // 6) Get all QRs for that branch + type; sort by numeric suffix DESC (top/backward)
//     const candidates = await QrCode.find({
//       $and: [
//         { $or: [{ branchId: branchObjectId }, { branchId: branch._id }] },
//         { vendorId: vendor.vendorId },
//         { type: { $in: typeCandidates } },
//       ],
//     })
//       .select("_id number type")
//       .lean();

//     if (!candidates.length) {
//       return res.status(200).json({
//         message: `No QRs found for type "${toTitleType(rawType)}" on this branch.`,
//         deleted: 0,
//         deletedNumbers: [],
//         newQrGenerated: branch.qrGenerated ?? 0,
//       });
//     }

//     candidates.sort((a, b) => suffixOf(b.number) - suffixOf(a.number)); // delete highest numbers first

//     const toDelete = candidates.slice(0, Math.min(count, candidates.length));
//     const ids = toDelete.map(d => d._id);
//     const deletedNumbers = toDelete.map(d => String(d.number || ""));

//     if (ids.length === 0) {
//       return res.status(200).json({
//         message: `Nothing to delete for type "${toTitleType(rawType)}".`,
//         deleted: 0,
//         deletedNumbers: [],
//         newQrGenerated: branch.qrGenerated ?? 0,
//       });
//     }

//     // 7) Delete selected docs
//     const delRes = await QrCode.deleteMany({ _id: { $in: ids } });
//     const actuallyDeleted = delRes?.deletedCount || 0;

//     // 8) Decrement branch.qrGenerated by actuallyDeleted (clamped to >= 0)
//     if (actuallyDeleted > 0) {
//       const fresh = await Branch.findById(branch._id, "qrGenerated").lean();
//       const current = Number(fresh?.qrGenerated ?? 0);
//       const next = Math.max(0, current - actuallyDeleted);
//       await Branch.findByIdAndUpdate(branch._id, { $set: { qrGenerated: next } });
//     }

//     const after = await Branch.findById(branch._id, "qrGenerated").lean();

//     return res.status(200).json({
//       message: `Deleted ${actuallyDeleted} ${toTitleType(rawType)} QR(s) from the top.`,
//       type: toTitleType(rawType),
//       deleted: actuallyDeleted,
//       deletedNumbers, // e.g. ["table-11", "table-10", ...]
//       newQrGenerated: Number(after?.qrGenerated ?? 0),
//     });
//   } catch (err) {
//     console.error("QR Delete Error:", err);
//     return res.status(500).json({ message: err.message });
//   }
// };

// // ✅ Exactly one default export:
// export default generateQr;
// // ✅ Named exports for others:
// export { getBranchQrs, deleteLatestQrs };

