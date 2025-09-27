import mongoose from "mongoose";

const vendorSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true }, // Firebase UID (owner)
    vendorId: { type: String, required: true, unique: true }, // Public stable ID
    vendorCode: { type: String, required: true, unique: true }, // Unique slug
    nameEnglish: { type: String, required: true },
    nameArabic: { type: String },

    email: { type: String },
    phone: { type: String },
    country: { type: String },
    timezone: { type: String },
    defaultCurrency: { type: String },

    logoUrl: { type: String },
    primaryColor: { type: String },
    secondaryColor: { type: String },
    cloudinaryFolder: { type: String },

    subscriptionPlan: {
      type: String,
      enum: ["FREE", "STARTER", "PRO", "ENTERPRISE"],
      default: "FREE",
    },
    subscriptionStatus: {
      type: String,
      enum: ["TRIAL", "ACTIVE", "PAST_DUE", "CANCELED"],
      default: "TRIAL",
    },
    subscriptionTrialEndsAt: { type: Date },

    allowedQRs: { type: Number, default: 5 },
    allowedLocations: { type: Number, default: 1 },

    serviceChargePct: { type: Number, default: 0 },
    vatPct: { type: Number, default: 0 },
    roundingRule: {
      type: String,
      enum: ["NONE", "NEAREST_005", "NEAREST_01"],
      default: "NONE",
    },

    deliverectEnabled: { type: Boolean, default: false },
    posType: {
      type: String,
      enum: ["NONE", "CLOVER", "MICROS", "SHIJI", "LOYVERSE"],
      default: "NONE",
    },
    posLocationId: { type: String, default: null },

    hmacSecret: { type: String, select: false },
    webhookSigningSecret: { type: String, select: false },

    isActive: { type: Boolean, default: true },
    isVerified: { type: Boolean, default: false },
    isSuspended: { type: Boolean, default: false },
    suspendReason: { type: String },

    allowedChannels: [{ type: String }],
    tags: [{ type: String }],
    locations: [{ type: String }],
    seats: [{ type: String }],

    qrPrefixTable: { type: String, default: "T" },
    qrPrefixRoom: { type: String, default: "R" },
    qrStartIndexTable: { type: Number, default: 1 },
    qrStartIndexRoom: { type: Number, default: 1 },

    createdBy: { type: String }, // userId who created
    updatedBy: { type: String }, // userId who updated
  },
  { timestamps: true }
);

const Vendor = mongoose.model("Vendor", vendorSchema);
export default Vendor;

