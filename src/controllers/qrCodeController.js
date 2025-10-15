import admin from "../config/firebase.js";
import QRCode from "qrcode";
import QrCode from "../models/QrCodeOrders.js";
import Branch from "../models/Branch.js";
import Vendor from "../models/Vendor.js";
import { generateQrId } from "../utils/generateQrId.js";

 const generateQr = async (req, res) => {
  try {
    const { token, branchId, type, numberOfQrs } = req.body;

    // 🔒 1. Validate Firebase token
    if (!token) {
      return res.status(400).json({ message: "Firebase token required" });
    }

    const decodedToken = await admin.auth().verifyIdToken(token);
    const userId = decodedToken.uid;
console.log("Decoded Token:", userId);
    // 🧩 2. Validate required fields
    if (!branchId || !type || !numberOfQrs) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // 🏢 3. Find vendor associated with this Firebase user
    const vendor = await Vendor.findOne({ userId });
    if (!vendor) {
      return res.status(404).json({ message: "No vendor associated with this account" });
    }

    // 🏬 4. Validate Branch
    const branch = await Branch.findOne({ branchId });
    if (!branch) {
      return res.status(404).json({ message: "Branch not found" });
    }

    // ensure branch belongs to this vendor
    if (branch.vendorId !== vendor.vendorId) {
      return res.status(403).json({ message: "Branch does not belong to your vendor account" });
    }

    // 📊 5. Check QR limit
    const remainingQrs = branch.qrLimit - branch.qrGenerated;
    if (numberOfQrs > remainingQrs) {
      return res.status(400).json({
        message: `QR limit exceeded. You can only generate ${remainingQrs} more QR codes.`,
        totalAllowed: branch.qrLimit,
      });
    }

    // 🌐 6. Generate QR codes
    const baseUrl = "https://yourapp.com/order";
    const qrArray = [];

    for (let i = 0; i < numberOfQrs; i++) {
      const qrId = await generateQrId();
      const qrDataUrl = `${baseUrl}?branch=${branchId}&type=${type}&qrId=${qrId}`;
      const qrImage = await QRCode.toDataURL(qrDataUrl);

      const qr = await QrCode.create({
        qrId,
        branchId: branch._id,
        vendorId: vendor.vendorId,
        type,
        number: `${type}-${i + 1}`,
        qrUrl: qrImage,
      });

      qrArray.push(qr);
    }

    // 🧾 7. Update branch QR count
    branch.qrGenerated += numberOfQrs;
    await branch.save();

    // ✅ 8. Response
    res.status(201).json({
      message: "QR codes generated successfully",
      generated: qrArray.length,
      qrs: qrArray,
    });
  } catch (error) {
    console.error("QR Generate Error:", error);
    res.status(500).json({ message: error.message });
  }
};
export default generateQr ;