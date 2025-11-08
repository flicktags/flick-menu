

// export default mongoose.model("QrCode", qrCodeSchema);

import mongoose from "mongoose";

const qrCodeSchema = new mongoose.Schema(
  {
    qrId: { type: String, unique: true, required: true }, // e.g., QR-000001

    // We store the Branch's Mongo _id as a STRING (to match existing data).
    // Queries in the controller already handle both string and ObjectId forms.
    branchId: { type: String, required: true, index: true },

    vendorId: { type: String, required: true, index: true },

    // Normalize to lowercase to match controller (table/room).
    type: {
      type: String,
      enum: ["room", "table"],
      required: true,
      set: v => (typeof v === "string" ? v.toLowerCase() : v),
      index: true,
    },

    // Optional freeform label (e.g., "VIP Room")
    label: { type: String },

    // Human-facing number like "table-6", "room-7"
    number: { type: String, required: true },

    // Prefer storing a URL (e.g., Cloudinary). Base64 works but is large.
    qrUrl: { type: String },

    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Prevent duplicates per branch (e.g., two "table-6" under the same branch)
qrCodeSchema.index({ branchId: 1, number: 1 }, { unique: true });

// Helpful sort/query indexes
qrCodeSchema.index({ branchId: 1, createdAt: 1 });
qrCodeSchema.index({ vendorId: 1, createdAt: 1 });

export default mongoose.model("QrCode", qrCodeSchema);