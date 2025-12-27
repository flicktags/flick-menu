import mongoose from "mongoose";

const customMenuTypeSchema = new mongoose.Schema(
  {
    code: { type: String, required: true }, // e.g. CUST_8F3K2A
    nameEnglish: { type: String, required: true },
    nameArabic: { type: String, default: "" },
    imageUrl: { type: String, default: "" }, // Cloudinary URL
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false } // ✅ we will identify items by `code`
);

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
    customMenuTypes: { type: [customMenuTypeSchema], default: [] },
    qrLimit: { type: Number, default: 0 }, 
    qrGenerated: { type: Number, default: 0 }, // how many generated so far
    status: { type: String, enum: ["active", "inactive", "archived"], default: "active" },
    menuVersion: { type: Number, default: 1 },
    menuUpdatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export default mongoose.model("Branch", branchSchema);

