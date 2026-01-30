// src/models/Branch.js
import mongoose from "mongoose";

const customMenuTypeSchema = new mongoose.Schema(
  {
    code: { type: String, required: true }, // e.g. CUST_8F3K2A
    nameEnglish: { type: String, required: true },
    nameArabic: { type: String, default: "" },
    imageUrl: { type: String, default: "" },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const menuSectionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, uppercase: true, trim: true }, // e.g. BRUNCH
    nameEnglish: { type: String, required: true },
    nameArabic: { type: String, default: "" },
    sortOrder: { type: Number, default: 0 },
    isEnabled: { type: Boolean, default: true },
    itemCount: { type: Number, default: 0 },
  },
  { _id: false },
);

const customizationSchema = new mongoose.Schema(
  {
    isClassicMenu: { type: Boolean, default: false },
  },
  { _id: false },
);

// ✅ NEW: Stations (future-proof beyond KDS)
const stationSchema = new mongoose.Schema(
  {
    stationId: { type: String, required: true, trim: true }, // unique within branch
    key: { type: String, required: true, uppercase: true, trim: true }, // MAIN, DINE_IN, BAR, SHEESHA
    nameEnglish: { type: String, required: true, trim: true },
    nameArabic: { type: String, default: "", trim: true },
    isEnabled: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    printers: { type: [String], default: [] }, // optional

    // ✅ NEW: PIN auth for station (hashed)
    pinHash: { type: String, default: "" },
    pinUpdatedAt: { type: Date, default: null },
    pinFailedCount: { type: Number, default: 0 },
    pinLockUntil: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const branchSchema = new mongoose.Schema(
  {
    branchId: { type: String, unique: true, required: true },
    publicSlug: { type: String, unique: true, sparse: true },
    vendorId: { type: String, required: true },
    userId: { type: String, required: true },

    nameEnglish: { type: String, required: true },
    nameArabic: { type: String },
    venueType: { type: String },
    // ✅ NEW: station-based KDS behavior toggle (default false)
    stationBased: { type: Boolean, default: false },

    serviceFeatures: [
      { type: String, enum: ["dine_in", "takeaway", "delivery"] },
    ],

    openingHours: {
      Mon: String,
      Tue: String,
      Wed: String,
      Thu: String,
      Fri: String,
      Sat: String,
      Sun: String,
    },

    contact: { email: String, phone: String },

    address: {
      addressLine: String,
      city: String,
      state: String,
      countryCode: String,
      coordinates: { lat: Number, lng: Number },
      mapPlaceId: String,
    },

    timeZone: String,
    currency: String,

    branding: {
      logo: String,
      coverBannerLogo: String,
      splashScreenEnabled: { type: Boolean, default: false },
    },

    taxes: {
      vatPercentage: { type: Number, default: 0 },
      serviceChargePercentage: { type: Number, default: 0 },
      vatNumber: { type: String, default: "" },
      isVatInclusive: { type: Boolean, default: true },

      platformFeePerOrder: { type: Number, default: null, min: 0 },
      showPlatformFee: { type: Boolean, default: true },
      platformFeePaidByCustomer: { type: Boolean, default: true },
    },

    qrSettings: {
      qrsAllowed: { type: Boolean, default: true },
      noOfQrs: { type: Number, default: 0 },
    },

    subscription: {
      plan: { type: String, default: "trial" },
      expiryDate: { type: Date },
    },

    menu: [{ type: mongoose.Schema.Types.ObjectId, ref: "Menu" }],

    customization: {
      type: customizationSchema,
      default: () => ({}),
    },

    menuSections: { type: [menuSectionSchema], default: [] },
    customMenuTypes: { type: [customMenuTypeSchema], default: [] },

    qrLimit: { type: Number, default: 0 },
    qrGenerated: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ["active", "inactive", "archived"],
      default: "active",
    },

    menuVersion: { type: Number, default: 1 },
    menuUpdatedAt: { type: Date, default: Date.now },

    // ✅ NEW: stations embedded inside branch
    stations: {
      type: [stationSchema],
      default: () => [
        {
          stationId: "ST-0001",
          key: "MAIN",
          nameEnglish: "Main",
          nameArabic: "",
          isEnabled: true,
          sortOrder: 0,
          printers: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    },
  },
  { timestamps: true },
);

// Helpful index if you search stations often (optional)
branchSchema.index({ branchId: 1 });

export default mongoose.model("Branch", branchSchema);

// // models/Branch.js
// import mongoose from "mongoose";

// const customMenuTypeSchema = new mongoose.Schema(
//   {
//     code: { type: String, required: true }, // e.g. CUST_8F3K2A
//     nameEnglish: { type: String, required: true },
//     nameArabic: { type: String, default: "" },
//     imageUrl: { type: String, default: "" }, // Cloudinary URL
//     isActive: { type: Boolean, default: true },
//     sortOrder: { type: Number, default: 0 },
//     createdAt: { type: Date, default: Date.now },
//     updatedAt: { type: Date, default: Date.now },
//   },
//   { _id: false } // ✅ we will identify items by `code`
// );

// const menuSectionSchema = new mongoose.Schema(
//   {
//     key: { type: String, required: true, uppercase: true, trim: true }, // e.g. BRUNCH
//     nameEnglish: { type: String, required: true },
//     nameArabic: { type: String, default: "" },
//     sortOrder: { type: Number, default: 0 },
//     isEnabled: { type: Boolean, default: true },
//     itemCount: { type: Number, default: 0 }, // maintained later by items CRUD
//   },
//   { _id: false }
// );

// const customizationSchema = new mongoose.Schema(
//   {
//     isClassicMenu: { type: Boolean, default: false },
//     // future options can go here
//   },
//   { _id: false }
// );

// const branchSchema = new mongoose.Schema(
//   {
//     branchId: { type: String, unique: true, required: true },
//     publicSlug: { type: String, unique: true, sparse: true }, // e.g., "X223-..."
//     vendorId: { type: String, required: true },
//     userId: { type: String, required: true },
//     nameEnglish: { type: String, required: true },
//     nameArabic: { type: String },
//     venueType: { type: String },
//     serviceFeatures: [
//       { type: String, enum: ["dine_in", "takeaway", "delivery"] },
//     ],
//     openingHours: {
//       Mon: String,
//       Tue: String,
//       Wed: String,
//       Thu: String,
//       Fri: String,
//       Sat: String,
//       Sun: String,
//     },
//     contact: { email: String, phone: String },
//     address: {
//       addressLine: String,
//       city: String,
//       state: String,
//       countryCode: String,
//       coordinates: { lat: Number, lng: Number },
//       mapPlaceId: String,
//     },
//     timeZone: String,
//     currency: String,
//     branding: {
//       logo: String,
//       coverBannerLogo: String,
//       splashScreenEnabled: { type: Boolean, default: false },
//     },
//     taxes: {
//       vatPercentage: { type: Number, default: 0 },
//       serviceChargePercentage: { type: Number, default: 0 },
//       vatNumber: { type: String, default: "" }, // ✅ NEW
//       isVatInclusive: { type: Boolean, default: true }, // ✅ NEW (best place)

//       platformFeePerOrder: { type: Number, default: null, min: 0 }, // e.g. 0.010
//       showPlatformFee: { type: Boolean, default: true }, // show line item in checkout/receipt?
//       platformFeePaidByCustomer: { type: Boolean, default: true }, // if false => vendor pays
//     },
//     qrSettings: {
//       qrsAllowed: { type: Boolean, default: true },
//       noOfQrs: { type: Number, default: 0 },
//     },
//     subscription: {
//       plan: { type: String, default: "trial" },
//       expiryDate: { type: Date }, // will be set by backend on create
//     },
//     // (existing) future: link to MenuItems if you want
//     menu: [{ type: mongoose.Schema.Types.ObjectId, ref: "Menu" }],

//     /**
//      * ✅ IMPORTANT CHANGE (keep field name same!)
//      * from:
//      *   customization: { isClassicMenu: { type: Boolean, default: false } }
//      * to:
//      *   customization: { type: customizationSchema, default: () => ({}) }
//      */
//     customization: {
//       type: customizationSchema,
//       default: () => ({}),
//     },

//     // NEW: lightweight enabled menu sections per branch
//     menuSections: { type: [menuSectionSchema], default: [] },
//     customMenuTypes: { type: [customMenuTypeSchema], default: [] },
//     qrLimit: { type: Number, default: 0 },
//     qrGenerated: { type: Number, default: 0 }, // how many generated so far
//     status: {
//       type: String,
//       enum: ["active", "inactive", "archived"],
//       default: "active",
//     },
//     menuVersion: { type: Number, default: 1 },
//     menuUpdatedAt: { type: Date, default: Date.now },
//     kdsStations: {
//   type: [
//     {
//       key: { type: String, required: true, uppercase: true, trim: true }, // DINE_IN, BAR, SHEESHA
//       nameEnglish: { type: String, required: true },
//       nameArabic: { type: String, default: "" },
//       isEnabled: { type: Boolean, default: true },
//       sortOrder: { type: Number, default: 0 },
//       printers: { type: [String], default: [] }, // optional later
//     },
//   ],
//   default: [],
// },

//   },
//   { timestamps: true }
// );

// export default mongoose.model("Branch", branchSchema);
