import Counter from "../models/VendorId.js";
export const generateQrId = async () => {
  const counter = await Counter.findOneAndUpdate(
    { name: "qrcode" },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  return `QR-${counter.seq.toString().padStart(6, "0")}`;
};
