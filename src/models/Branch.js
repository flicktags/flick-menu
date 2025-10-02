import mongoose from "mongoose";

const branchSchema = new mongoose.Schema(
  {
    branchId: { type: String, unique: true, required: true }, // e.g., BR-000001
    vendorId: { type: String, required: true }, // link to Vendor.vendorId
    userId: { type: String, required: true }, // Firebase UID (owner/creator)

    nameEnglish: { type: String, required: true },
    nameArabic: { type: String },
    venueType: { type: String }, // e.g., Bistro, Restaurant

    serviceFeatures: [{ type: String, enum: ["dine_in", "takeaway", "delivery"] }],

    openingHours: {
      Mon: { type: String },
      Tue: { type: String },
      Wed: { type: String },
      Thu: { type: String },
      Fri: { type: String },
      Sat: { type: String },
      Sun: { type: String },
    },

    contact: {
      email: { type: String },
      phone: { type: String },
    },

    address: {
      addressLine: { type: String },
      city: { type: String },
      state: { type: String },
      countryCode: { type: String }, // ISO code
      coordinates: {
        lat: { type: Number },
        lng: { type: Number },
      },
      mapPlaceId: { type: String },
    },

    timeZone: { type: String },
    currency: { type: String },

    branding: {
      logo: { type: String },
      coverBannerLogo: { type: String },
    },

    taxes: {
      vatPercentage: { type: Number },
      serviceChargePercentage: { type: Number },
    },

    qrSettings: {
      qrsAllowed: { type: Boolean, default: true },
      noOfQrs: { type: Number, default: 0 },
    },

    subscription: {
      plan: { type: String },
      expiryDate: { type: Date },
    },

    menu: [{ type: mongoose.Schema.Types.ObjectId, ref: "Menu" }],

    status: { type: String, enum: ["active", "inactive", "archived"], default: "active" },
  },
  { timestamps: true }
);

export default mongoose.model("Branch", branchSchema);