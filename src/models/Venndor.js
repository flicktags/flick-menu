import mongoose from "mongoose";

const vendorSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true }, // Firebase UID (owner)
    vendorId: { type: String, unique: true, required: true }, // Sequential ID like v100101
    businessName: { type: String, required: true },
    brandName: { type: String },
    venueType: { type: String }, // e.g., bistro, restaurant, cafe

    contactPhone: { type: String },
    email: { type: String },

    country: { type: String },
    state: { type: String },
    city: { type: String },

    logoUrl: { type: String },
    isActive: { type: Boolean, default: true },

    billing: {
      vatNumber: { type: String },
      address: { type: String },
    },

    features: {
      reservations: { type: Boolean, default: false },
      delivery: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

export default mongoose.model("Vendor", vendorSchema);
