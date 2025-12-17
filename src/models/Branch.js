// import mongoose from "mongoose";

// const branchSchema = new mongoose.Schema(
//   {
//     branchId: { type: String, unique: true, required: true }, // e.g., BR-000001
//     vendorId: { type: String, required: true }, // link to Vendor.vendorId
//     userId: { type: String, required: true }, // Firebase UID (owner/creator)

//     nameEnglish: { type: String, required: true },
//     nameArabic: { type: String },
//     venueType: { type: String }, // e.g., Bistro, Restaurant

//     serviceFeatures: [{ type: String, enum: ["dine_in", "takeaway", "delivery"] }],

//     openingHours: {
//       Mon: { type: String },
//       Tue: { type: String },
//       Wed: { type: String },
//       Thu: { type: String },
//       Fri: { type: String },
//       Sat: { type: String },
//       Sun: { type: String },
//     },

//     contact: {
//       email: { type: String },
//       phone: { type: String },
//     },

//     address: {
//       addressLine: { type: String },
//       city: { type: String },
//       state: { type: String },
//       countryCode: { type: String }, // ISO code
//       coordinates: {
//         lat: { type: Number },
//         lng: { type: Number },
//       },
//       mapPlaceId: { type: String },
//     },

//     timeZone: { type: String },
//     currency: { type: String },

//     branding: {
//       logo: { type: String },
//       coverBannerLogo: { type: String },
//     },

//     taxes: {
//       vatPercentage: { type: Number },
//       serviceChargePercentage: { type: Number },
//     },

//     qrSettings: {
//       qrsAllowed: { type: Boolean, default: true },
//       noOfQrs: { type: Number, default: 0 },
//     },

//     subscription: {
//       plan: { type: String },
//       expiryDate: { type: Date },
//     },

//     menu: [{ type: mongoose.Schema.Types.ObjectId, ref: "Menu" }],

//     status: { type: String, enum: ["active", "inactive", "archived"], default: "active" },
//   },
//   { timestamps: true }
// );

// export default mongoose.model("Branch", branchSchema);
// models/Branch.js
import mongoose from "mongoose";

const menuSectionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, uppercase: true, trim: true }, // e.g. BRUNCH
    nameEnglish: { type: String, required: true },
    nameArabic: { type: String, default: "" },
    sortOrder: { type: Number, default: 0 },
    isEnabled: { type: Boolean, default: true },
    itemCount: { type: Number, default: 0 }, // maintained later by items CRUD
  },
  { _id: false }
);

const branchSchema = new mongoose.Schema(
  {
    branchId: { type: String, unique: true, required: true },
    publicSlug: { type: String, unique: true, sparse: true }, // e.g., "X223-4kkfkk482jjdjjlk2344-5666"
    vendorId: { type: String, required: true },
    userId: { type: String, required: true },
    nameEnglish: { type: String, required: true },
    nameArabic: { type: String },
    venueType: { type: String },
    serviceFeatures: [{ type: String, enum: ["dine_in", "takeaway", "delivery"] }],
    openingHours: { Mon: String, Tue: String, Wed: String, Thu: String, Fri: String, Sat: String, Sun: String },
    contact: { email: String, phone: String },
    address: {
      addressLine: String, city: String, state: String, countryCode: String,
      coordinates: { lat: Number, lng: Number }, mapPlaceId: String,
    },
    timeZone: String,
    currency: String,
    branding: { 
      logo: String, 
      coverBannerLogo: String, 
      splashScreenEnabled: { type: Boolean, default: false },
 },
    taxes: { vatPercentage: Number, serviceChargePercentage: Number },
    qrSettings: { qrsAllowed: { type: Boolean, default: true }, noOfQrs: { type: Number, default: 0 } },
    subscription: { plan: String, expiryDate: Date },

    // (existing) future: link to MenuItems if you want
    menu: [{ type: mongoose.Schema.Types.ObjectId, ref: "Menu" }],

    // NEW: lightweight enabled menu sections per branch
    menuSections: { type: [menuSectionSchema], default: [] }, 
    qrLimit: { type: Number, default: 0 }, 
    qrGenerated: { type: Number, default: 0 }, // how many generated so far
    status: { type: String, enum: ["active", "inactive", "archived"], default: "active" },
    menuVersion: { type: Number, default: 1 },
    menuUpdatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export default mongoose.model("Branch", branchSchema);

