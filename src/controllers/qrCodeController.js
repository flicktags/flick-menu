import QRCode from "qrcode";
import QrCode from "../models/QrCodeOrders.js";
import { generateQrId } from "../utils/generateQrId.js";

 const generateQr = async (req, res) => {
  try {
    const { branchId, vendorId, type, number, label } = req.body;

    if (!branchId || !vendorId || !type || !number) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // create unique qrId
    const qrId = await generateQrId();

    // create link to be encoded (frontend URL)
    const baseUrl = "https://yourapp.com/order";
    const qrDataUrl = `${baseUrl}?branch=${branchId}&type=${type}&no=${number}`;

    // generate QR code image (Base64)
    const qrImage = await QRCode.toDataURL(qrDataUrl);

    // save in DB
    const qr = await QrCode.create({
      qrId,
      branchId,
      vendorId,
      type,
      label,
      number,
      qrUrl: qrImage
    });

    res.status(201).json({
      message: "QR Code generated successfully",
      qr
    });
  } catch (error) {
    console.error("QR Generate Error:", error);
    res.status(500).json({ message: error.message });
  } 
};
export default generateQr;