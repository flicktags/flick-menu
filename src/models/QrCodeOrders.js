import mongoose from "mongoose";

const qrCodeSchema = new mongoose.Schema(
  {
    qrId: { type: String, unique: true, required: true }, // e.g., QR-000001
    branchId: { type: String, required: true },
    vendorId: { type: String, required: true },
    type: { type: String, enum: ["room", "table"], required: true },
    label: { type: String }, // e.g. "VIP Room", "Table 5"
    number: { type: String, required: true }, // e.g. "101", "T5"
    qrUrl: { type: String }, // Cloudinary URL or base64 string
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

export default mongoose.model("QrCode", qrCodeSchema);
