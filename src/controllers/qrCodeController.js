import admin from "../config/firebase.js";
import QRCode from "qrcode";
import QrCode from "../models/QrCodeOrders.js";
import Branch from "../models/Branch.js";
import Vendor from "../models/Vendor.js";
import { generateQrId } from "../utils/generateQrId.js";

//  const generateQr = async (req, res) => {
//   try {
//     const { token, branchId, type, numberOfQrs } = req.body;

//     // 🔒 1. Validate Firebase token
//     if (!token) {
//       return res.status(400).json({ message: "Firebase token required" });
//     }

//     const decodedToken = await admin.auth().verifyIdToken(token);
//     const userId = decodedToken.uid;
//  console.log("Decoded Token:", userId);
//     // 🧩 2. Validate required fields
//     if (!branchId || !type || !numberOfQrs) {
//       return res.status(400).json({ message: "Missing required fields" });
//     }

//     // 🏢 3. Find vendor associated with this Firebase user
//     const vendor = await Vendor.findOne({ userId });
//     if (!vendor) {
//       return res.status(404).json({ message: "No vendor associated with this account" });
//     }

//     // 🏬 4. Validate Branch
//     const branch = await Branch.findOne({ branchId });
//     if (!branch) {
//       return res.status(404).json({ message: "Branch not found" });
//     }

//     // ensure branch belongs to this vendor
//     if (branch.vendorId !== vendor.vendorId) {
//       return res.status(403).json({ message: "Branch does not belong to your vendor account" });
//     }

//     // 📊 5. Check QR limit
//     const remainingQrs = branch.qrLimit - branch.qrGenerated;
//     if (numberOfQrs > remainingQrs) {
//       return res.status(400).json({
//         message: `QR limit exceeded. You can only generate ${remainingQrs} more QR codes.`,
//         totalAllowed: branch.qrLimit,
//       });
//     }

//     // 🌐 6. Generate QR codes
//     const baseUrl = "https://yourapp.com/order";
//     const qrArray = [];

//     for (let i = 0; i < numberOfQrs; i++) {
//       const qrId = await generateQrId();
//       const qrDataUrl = `${baseUrl}?branch=${branchId}&type=${type}&qrId=${qrId}`;
//       const qrImage = await QRCode.toDataURL(qrDataUrl);

//       const qr = await QrCode.create({
//         qrId,
//         branchId: branch._id,
//         vendorId: vendor.vendorId,
//         type,
//         number: `${type}-${i + 1}`,
//         qrUrl: qrImage,
//       });

//       qrArray.push(qr);
//     }

//     // 🧾 7. Update branch QR count
//     branch.qrGenerated += numberOfQrs;
//     await branch.save();

//     // ✅ 8. Response
//     res.status(201).json({
//       message: "QR codes generated successfully",
//       generated: qrArray.length,
//       qrs: qrArray,
//     });
//   } catch (error) {
//     console.error("QR Generate Error:", error);
//     res.status(500).json({ message: error.message });
//   }
// };
// export default generateQr ;

const generateQr = async (req, res) => {
  try {
    // Prefer Authorization header, fallback to body.token (for backward compat)
    const authHeader = req.headers.authorization || "";
    const hdrToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const token = hdrToken || req.body.token;

    const { branchId, type, numberOfQrs, label } = req.body;

    // 🔒 1) Validate token
    if (!token) {
      return res.status(400).json({ message: "Firebase token required" });
    }
    const decodedToken = await admin.auth().verifyIdToken(token);
    const userId = decodedToken.uid;

    // 🧩 2) Validate required fields
    if (!branchId || !type || !numberOfQrs) {
      return res.status(400).json({ message: "Missing required fields" });
    }
    const count = parseInt(numberOfQrs, 10);
    if (!Number.isFinite(count) || count <= 0) {
      return res.status(400).json({ message: "numberOfQrs must be a positive integer" });
    }

    // 🏢 3) Resolve vendor from Firebase user
    const vendor = await Vendor.findOne({ userId });
    if (!vendor) {
      return res.status(404).json({ message: "No vendor associated with this account" });
    }

    // 🏬 4) Validate branch by business id (e.g., BR-000005)
    const branch = await Branch.findOne({ branchId });
    if (!branch) {
      return res.status(404).json({ message: "Branch not found" });
    }
    if (branch.vendorId !== vendor.vendorId) {
      return res.status(403).json({ message: "Branch does not belong to your vendor account" });
    }

    // 📊 5) Check QR limit
    const remainingQrs = branch.qrLimit - branch.qrGenerated;
    if (count > remainingQrs) {
      return res.status(400).json({
        message: `QR limit exceeded. You can only generate ${remainingQrs} more QR codes.`,
        totalAllowed: branch.qrLimit,
      });
    }

    // 🔢 6) Determine the next starting number per (branch + type)
    //    We read all existing numbers for this branch/type and compute the max suffix.
    //    (If you have a lot of rows, you can switch to a Mongo aggregation to compute max on the server.)
    const existing = await QrCode
      .find({
        $and: [
          { $or: [{ branchId: branch._id }, { branchId: branchId }] }, // stored as ObjectId or string
          { vendorId: vendor.vendorId },
          { type: type }, // keep the same case you store; if you want lowercase, normalize both here and when creating
        ],
      })
      .select("number")
      .lean();

    let maxSuffix = 0;
    const suffixRegex = /(\d+)$/;
    for (const doc of existing) {
      const n = (doc.number || "").toString();
      const m = n.match(suffixRegex);
      if (m) {
        const val = parseInt(m[1], 10);
        if (Number.isFinite(val) && val > maxSuffix) maxSuffix = val;
      }
    }

    // 🌐 7) Generate QR codes, continuing the sequence
    const baseUrl = "https://yourapp.com/order";
    const created = [];
    for (let i = 0; i < count; i++) {
      const nextNum = maxSuffix + i + 1; // continue sequence
      const qrId = await generateQrId();
      const qrDataUrl = `${baseUrl}?branch=${branchId}&type=${type}&qrId=${qrId}`;
      const qrImage = await QRCode.toDataURL(qrDataUrl);

      const qr = await QrCode.create({
        qrId,
        branchId: branch._id,     // store the Mongo _id
        vendorId: vendor.vendorId,
        type,                      // keep as sent; or normalize if you prefer
        label: label || undefined, // optional
        number: `${type}-${nextNum}`,
        qrUrl: qrImage,
      });

      created.push(qr);
    }

    // 🧾 8) Update branch QR count
    branch.qrGenerated += count;
    await branch.save();

    // ✅ 9) Response
    return res.status(201).json({
      message: "QR codes generated successfully",
      generated: created.length,
      qrs: created,
    });
  } catch (error) {
    console.error("QR Generate Error:", error);
    return res.status(500).json({ message: error.message });
  }
};

export default generateQr;

export const getBranchQrs = async (req, res) => {
  try {
    // Prefer Authorization: Bearer <token>, fallback ?token=...
    const authHeader = req.headers.authorization || "";
    const hdrToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const token = hdrToken || req.query.token;
    if (!token) return res.status(400).json({ message: "Firebase token required" });

    // Verify token → userId → vendor
    const decoded = await admin.auth().verifyIdToken(token);
    const userId = decoded.uid;

    const vendor = await Vendor.findOne({ userId });
    if (!vendor) return res.status(404).json({ message: "No vendor associated with this account" });

    // Params
    const { branchId } = req.params; // Mongo _id string, e.g. "68e40176727a4e93b229efab"
    if (!branchId) return res.status(400).json({ message: "branchId (Mongo _id) is required" });

    // Validate branch and ownership
    const branch = await Branch.findById(branchId);
    if (!branch) return res.status(404).json({ message: "Branch not found" });
    if (branch.vendorId !== vendor.vendorId) {
      return res.status(403).json({ message: "Branch does not belong to your vendor account" });
    }

    // Build filter that works whether QrCode.branchId is stored as String or ObjectId
    const filters = [{ branchId: branchId }, { branchId: branch._id }];
    // Extra safety: ensure QR records are for the same vendor
    filters.push({ vendorId: vendor.vendorId });

    const query = {
      $and: [
        { $or: [{ branchId: branchId }, { branchId: branch._id }] },
        { vendorId: vendor.vendorId },
      ],
    };

    const items = await QrCode.find(query).sort({ createdAt: -1 }).lean();
    return res.status(200).json({
      branchId: branch._id.toString(),
      vendorId: vendor.vendorId,
      total: items.length,
      items,
    });
  } catch (err) {
    console.error("QR List Error:", err);
    return res.status(500).json({ message: err.message });
  }
};