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

// models/Vendor.js
import mongoose from "mongoose";

const vendorSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    vendorId: { type: String, unique: true, required: true },

    businessName: { type: String },
    arabicbBusinessName: { type: String },
    contactPhone: { type: String },
    email: { type: String },

    country: { type: String },

    branchAllowed: { type: Number, default: 1 },
    logoUrl: { type: String },
    isActive: { type: Boolean, default: true },

    billing: {
      vatNumber: { type: String },
    },

    // NEW: store a numeric VAT percentage for the vendor (0..100)
    taxes: {
      vatPercentage: { type: Number, min: 0, max: 100 }, // no default -> stays undefined unless you set it
    },

    updates: {
      createdDate: { type: Date, default: Date.now },
      activatedDate: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

export default mongoose.model("Vendor", vendorSchema);

