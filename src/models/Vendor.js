// import mongoose from "mongoose";

// const vendorSchema = new mongoose.Schema(
//   {
//     userId: { type: String, required: true }, // Firebase UID (owner)
//     vendorId: { type: String, unique: true, required: true }, // Sequential ID like v100101
//     businessName: { type: String, required: false },
//     arabicbBusinessName: { type: String, required: false },
//     contactPhone: { type: String },
//     email: { type: String },

//     country: { type: String },
   
//     branchAllowed: { type: Number, default: 1 },
//     logoUrl: { type: String },
//     isActive: { type: Boolean, default: true },

//     billing: {
//       vatNumber: { type: String },
//     },

//     updates: {
//       createdDate: { type: Date, default: Date.now },
//       activatedDate: { type: Date, default: null },
//     },
//   },
//   { timestamps: true }
// );

// export default mongoose.model("Vendor", vendorSchema);

import mongoose from "mongoose";

const vendorSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },           // Firebase UID (owner)
    vendorId: { type: String, unique: true, required: true },

    businessName: { type: String },
    arabicbBusinessName: { type: String },
    contactPhone: { type: String },
    email: { type: String },

    country: { type: String },

    branchAllowed: { type: Number, default: 1 },
    logoUrl: { type: String },
    isActive: { type: Boolean, default: true },

    // NEW: billing.vatNumber already existed; keep it and use it
    billing: {
      vatNumber: { type: String },                      // e.g. "2663748849994"
    },

    // NEW: taxes & settings (kept flexible and backward compatible)
    taxes: {
      // store as percentage (0..100) in DB; API can expose decimal via /public
      vatPercentage: { type: Number, min: 0, max: 100, default: 0 },
      serviceChargePercentage: { type: Number, min: 0, max: 100, default: 0 },
    },

    settings: {
      // whether your base prices already include VAT
      priceIncludesVat: { type: Boolean, default: false },
    },

    updates: {
      createdDate: { type: Date, default: Date.now },
      activatedDate: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

export default mongoose.model("Vendor", vendorSchema);
