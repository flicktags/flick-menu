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
    if (!token) {
      return res.status(400).json({ message: "Firebase token required" });
    }
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

    // normalize type to lowercase for storage/number prefix
    const type = typeRaw.toLowerCase();
    if (!["table", "room"].includes(type)) {
      return res.status(400).json({ message: 'type must be "table" or "room"' });
    }
    const label = typeof labelRaw === "string" && labelRaw.trim().length > 0 ? labelRaw.trim() : undefined;

    // 3) Vendor by Firebase user
    const vendor = await Vendor.findOne({ userId }).lean();
    if (!vendor) {
      return res.status(404).json({ message: "No vendor associated with this account" });
    }

    // 4) Branch by business id (e.g., BR-000004)
    const branch = await Branch.findOne({ branchId: branchBusinessId }).lean();
    if (!branch) {
      return res.status(404).json({ message: "Branch not found" });
    }
    if (branch.vendorId !== vendor.vendorId) {
      return res.status(403).json({ message: "Branch does not belong to your vendor account" });
    }

    // 5) Check limits
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
      { new: false } // return the previous doc (so we know the starting number)
    ).lean();

    if (!prev) {
      return res.status(404).json({ message: "Branch not found (during update)" });
    }

    const startIndex = Number(prev.qrGenerated ?? 0) + 1; // if 0 -> start from 1
    const baseUrl = "https://yourapp.com/order";

    // 7) Create the QR docs
    const created = [];
    for (let i = 0; i < count; i++) {
      const suffix = startIndex + i;               // 1..N (branch-wide)
      const qrId = await generateQrId();
      const qrDataUrl = `${baseUrl}?branch=${encodeURIComponent(branchBusinessId)}&type=${encodeURIComponent(type)}&qrId=${encodeURIComponent(qrId)}`;
      const qrImage = await QRCode.toDataURL(qrDataUrl);

      const doc = await QrCode.create({
        qrId,
        branchId: String(branch._id),              // store Mongo _id as string (matches your current usage)
        vendorId: vendor.vendorId,
        type,                                      // store normalized lowercase
        label,
        number: `${type}-${suffix}`,
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

    // 8) Respond (DO NOT add to qrGenerated again here)
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
 * - Auth: Authorization: Bearer <token> (no query/body token)
 * - Returns QRs in ASCENDING order (table-1 ... table-N).
 */
export const getBranchQrs = async (req, res) => {
  try {
    // 1) Auth (header only, per your requirement)
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

    // 4) Fetch all QRs for that branch (handle both string/ObjId storage)
    const items = await QrCode.find({
      $and: [
        { $or: [{ branchId: branchObjectId }, { branchId: branch._id }] },
        { vendorId: vendor.vendorId },
      ],
    })
      // Ascending order so you'll see table-1 ... table-5
      .sort({ createdAt: 1, _id: 1 })
      .lean();

    return res.status(200).json({
      branchObjectId,
      branchId: branch.branchId,     // business id (BR-000004)
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

// //  const generateQr = async (req, res) => {
// //   try {
// //     const { token, branchId, type, numberOfQrs } = req.body;

// //     // 🔒 1. Validate Firebase token
// //     if (!token) {
// //       return res.status(400).json({ message: "Firebase token required" });
// //     }

// //     const decodedToken = await admin.auth().verifyIdToken(token);
// //     const userId = decodedToken.uid;
// //  console.log("Decoded Token:", userId);
// //     // 🧩 2. Validate required fields
// //     if (!branchId || !type || !numberOfQrs) {
// //       return res.status(400).json({ message: "Missing required fields" });
// //     }

// //     // 🏢 3. Find vendor associated with this Firebase user
// //     const vendor = await Vendor.findOne({ userId });
// //     if (!vendor) {
// //       return res.status(404).json({ message: "No vendor associated with this account" });
// //     }

// //     // 🏬 4. Validate Branch
// //     const branch = await Branch.findOne({ branchId });
// //     if (!branch) {
// //       return res.status(404).json({ message: "Branch not found" });
// //     }

// //     // ensure branch belongs to this vendor
// //     if (branch.vendorId !== vendor.vendorId) {
// //       return res.status(403).json({ message: "Branch does not belong to your vendor account" });
// //     }

// //     // 📊 5. Check QR limit
// //     const remainingQrs = branch.qrLimit - branch.qrGenerated;
// //     if (numberOfQrs > remainingQrs) {
// //       return res.status(400).json({
// //         message: `QR limit exceeded. You can only generate ${remainingQrs} more QR codes.`,
// //         totalAllowed: branch.qrLimit,
// //       });
// //     }

// //     // 🌐 6. Generate QR codes
// //     const baseUrl = "https://yourapp.com/order";
// //     const qrArray = [];

// //     for (let i = 0; i < numberOfQrs; i++) {
// //       const qrId = await generateQrId();
// //       const qrDataUrl = `${baseUrl}?branch=${branchId}&type=${type}&qrId=${qrId}`;
// //       const qrImage = await QRCode.toDataURL(qrDataUrl);

// //       const qr = await QrCode.create({
// //         qrId,
// //         branchId: branch._id,
// //         vendorId: vendor.vendorId,
// //         type,
// //         number: `${type}-${i + 1}`,
// //         qrUrl: qrImage,
// //       });

// //       qrArray.push(qr);
// //     }

// //     // 🧾 7. Update branch QR count
// //     branch.qrGenerated += numberOfQrs;
// //     await branch.save();

// //     // ✅ 8. Response
// //     res.status(201).json({
// //       message: "QR codes generated successfully",
// //       generated: qrArray.length,
// //       qrs: qrArray,
// //     });
// //   } catch (error) {
// //     console.error("QR Generate Error:", error);
// //     res.status(500).json({ message: error.message });
// //   }
// // };
// // export default generateQr ;

// const generateQr = async (req, res) => {
//   try {
//     // Prefer Authorization header, fallback to body.token (for backward compat)
//     const authHeader = req.headers.authorization || "";
//     const hdrToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
//     const token = hdrToken || req.body.token;

//     const { branchId, type, numberOfQrs, label } = req.body;

//     // 🔒 1) Validate token
//     if (!token) {
//       return res.status(400).json({ message: "Firebase token required" });
//     }
//     const decodedToken = await admin.auth().verifyIdToken(token);
//     const userId = decodedToken.uid;

//     // 🧩 2) Validate required fields
//     if (!branchId || !type || !numberOfQrs) {
//       return res.status(400).json({ message: "Missing required fields" });
//     }
//     const count = parseInt(numberOfQrs, 10);
//     if (!Number.isFinite(count) || count <= 0) {
//       return res.status(400).json({ message: "numberOfQrs must be a positive integer" });
//     }

//     // 🏢 3) Resolve vendor from Firebase user
//     const vendor = await Vendor.findOne({ userId });
//     if (!vendor) {
//       return res.status(404).json({ message: "No vendor associated with this account" });
//     }

//     // 🏬 4) Validate branch by business id (e.g., BR-000005)
//     const branch = await Branch.findOne({ branchId });
//     if (!branch) {
//       return res.status(404).json({ message: "Branch not found" });
//     }
//     if (branch.vendorId !== vendor.vendorId) {
//       return res.status(403).json({ message: "Branch does not belong to your vendor account" });
//     }

//     // 📊 5) Check QR limit
//     const remainingQrs = branch.qrLimit - branch.qrGenerated;
//     if (count > remainingQrs) {
//       return res.status(400).json({
//         message: `QR limit exceeded. You can only generate ${remainingQrs} more QR codes.`,
//         totalAllowed: branch.qrLimit,
//       });
//     }

//     // 🔢 6) Determine the next starting number per (branch + type)
//     //    We read all existing numbers for this branch/type and compute the max suffix.
//     //    (If you have a lot of rows, you can switch to a Mongo aggregation to compute max on the server.)
//     const existing = await QrCode
//       .find({
//         $and: [
//           { $or: [{ branchId: branch._id }, { branchId: branchId }] }, // stored as ObjectId or string
//           { vendorId: vendor.vendorId },
//           { type: type }, // keep the same case you store; if you want lowercase, normalize both here and when creating
//         ],
//       })
//       .select("number")
//       .lean();

//     let maxSuffix = 0;
//     const suffixRegex = /(\d+)$/;
//     for (const doc of existing) {
//       const n = (doc.number || "").toString();
//       const m = n.match(suffixRegex);
//       if (m) {
//         const val = parseInt(m[1], 10);
//         if (Number.isFinite(val) && val > maxSuffix) maxSuffix = val;
//       }
//     }

//     // 🌐 7) Generate QR codes, continuing the sequence
//     const baseUrl = "https://yourapp.com/order";
//     const created = [];
//     for (let i = 0; i < count; i++) {
//       const nextNum = maxSuffix + i + 1; // continue sequence
//       const qrId = await generateQrId();
//       const qrDataUrl = `${baseUrl}?branch=${branchId}&type=${type}&qrId=${qrId}`;
//       const qrImage = await QRCode.toDataURL(qrDataUrl);

//       const qr = await QrCode.create({
//         qrId,
//         branchId: branch._id,     // store the Mongo _id
//         vendorId: vendor.vendorId,
//         type,                      // keep as sent; or normalize if you prefer
//         label: label || undefined, // optional
//         number: `${type}-${nextNum}`,
//         qrUrl: qrImage,
//       });

//       created.push(qr);
//     }

//     // 🧾 8) Update branch QR count
//     branch.qrGenerated += count;
//     await branch.save();

//     // ✅ 9) Response
//     return res.status(201).json({
//       message: "QR codes generated successfully",
//       generated: created.length,
//       qrs: created,
//     });
//   } catch (error) {
//     console.error("QR Generate Error:", error);
//     return res.status(500).json({ message: error.message });
//   }
// };

// export default generateQr;

// export const getBranchQrs = async (req, res) => {
//   try {
//     // Prefer Authorization: Bearer <token>, fallback ?token=...
//     const authHeader = req.headers.authorization || "";
//     const hdrToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
//     const token = hdrToken || req.query.token;
//     if (!token) return res.status(400).json({ message: "Firebase token required" });

//     // Verify token → userId → vendor
//     const decoded = await admin.auth().verifyIdToken(token);
//     const userId = decoded.uid;

//     const vendor = await Vendor.findOne({ userId });
//     if (!vendor) return res.status(404).json({ message: "No vendor associated with this account" });

//     // Params
//     const { branchId } = req.params; // Mongo _id string, e.g. "68e40176727a4e93b229efab"
//     if (!branchId) return res.status(400).json({ message: "branchId (Mongo _id) is required" });

//     // Validate branch and ownership
//     const branch = await Branch.findById(branchId);
//     if (!branch) return res.status(404).json({ message: "Branch not found" });
//     if (branch.vendorId !== vendor.vendorId) {
//       return res.status(403).json({ message: "Branch does not belong to your vendor account" });
//     }

//     // Build filter that works whether QrCode.branchId is stored as String or ObjectId
//     const filters = [{ branchId: branchId }, { branchId: branch._id }];
//     // Extra safety: ensure QR records are for the same vendor
//     filters.push({ vendorId: vendor.vendorId });

//     const query = {
//       $and: [
//         { $or: [{ branchId: branchId }, { branchId: branch._id }] },
//         { vendorId: vendor.vendorId },
//       ],
//     };

//     const items = await QrCode.find(query).sort({ createdAt: -1 }).lean();
//     return res.status(200).json({
//       branchId: branch._id.toString(),
//       vendorId: vendor.vendorId,
//       total: items.length,
//       items,
//     });
//   } catch (err) {
//     console.error("QR List Error:", err);
//     return res.status(500).json({ message: err.message });
//   }
// };