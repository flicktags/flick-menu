import mongoose from "mongoose";
const branchSchema = new mongoose.Schema(
  {
    vendorId: { type: String, required: true }, // link to Vendor.vendorId
    userId: { type: String, required: true }, // Firebase UID (owner)

    businessName: { type: String, required: true },
    brandName: { type: String },
    venueType: { type: String },

    qrCount: { type: Number, default: 0 },
    branchPhone: { type: String },
    branchEmail: { type: String },

    country: { type: String },
    state: { type: String },
    city: { type: String },
    addressLine: { type: String },
    timezone: { type: String },
    currency: { type: String },

    hours: [
      {
        day: String,
        open: String,
        close: String,
      },
    ],

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("Branch", branchSchema); //