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
    isClassicMenuwithFullImage: { type: Boolean, default: false },
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

/**
 * ✅ VUE WALLET (embedded snapshot)
 * - All balances are stored in FILS as integers (1 BHD = 1000 fils)
 * - Ledger / transaction history should be in a separate collection (we will do next)
 */
const walletSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },

    // ✅ FILS (integer)
    paidBalanceFils: { type: Number, default: 0, min: 0 },
    bonusBalanceFils: { type: Number, default: 0, min: 0 },

    // ✅ Vendor choice: consume bonus first or paid first
    consumeMode: {
      type: String,
      enum: ["BONUS_FIRST", "PAID_FIRST"],
      default: "BONUS_FIRST",
    },

    // ✅ Vendor configurable; server can enforce default too
    notifyAtRemainingPct: { type: Number, default: 5, min: 0, max: 100 },

    // ✅ Ordering lock controls
    orderingLocked: { type: Boolean, default: false },
    exhaustedAt: { type: Date, default: null },

    // ✅ After exhausted, allow browsing but lock ordering; require refill within X days
    gracePeriodDaysAfterExhaustion: { type: Number, default: 2, min: 0 },

    // ✅ Optional pointers for audit/debug
    lastTxnId: { type: String, default: "" },
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
    callAssistance: {type: Boolean, default: false},
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
