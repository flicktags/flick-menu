import mongoose from "mongoose";

const { Schema, model } = mongoose;

const sizeSchema = new Schema(
  {
    label: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const discountSchema = new Schema(
  {
    type: { type: String, enum: ["percentage", "amount"], required: true },
    value: { type: Number, required: true, min: 0 },
    validUntil: { type: Date },
  },
  { _id: false }
);

const addonOptionSchema = new Schema(
  {
    label: { type: String, required: true, trim: true },
    price: { type: Number, default: 0, min: 0 },
    sku: { type: String, trim: true },
    isDefault: { type: Boolean, default: false },
  },
  { _id: false }
);

const addonSchema = new Schema(
  {
    label: { type: String, required: true, trim: true },
    required: { type: Boolean, default: false },
    min: { type: Number, default: 0 },
    max: { type: Number, default: 1 },
    options: { type: [addonOptionSchema], default: [] },
  },
  { _id: false }
);

const menuItemSchema = new Schema(
  {
    // ownership
    branchId: { type: String, required: true, index: true },
    vendorId: { type: String, required: true, index: true },

    // placement
    sectionKey: { type: String, required: true, uppercase: true, trim: true, index: true },
    sortOrder: { type: Number, default: 0 },

    // identity
    itemType: { type: String, default: "", trim: true },
    nameEnglish: { type: String, required: true, trim: true },
    nameArabic: { type: String, required: true, trim: true },
    description: { type: String, default: "" },

    // media
    imageUrl: { type: String, default: "" },
    videoUrl: { type: String, default: "" },

    // labels
    allergens: { type: [String], default: [] }, // e.g. ["gluten","dairy"]
    tags: { type: [String], default: [] },      // e.g. ["BEST_SELLER"]

    // status
    isFeatured: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    isAvailable: { type: Boolean, default: true },
    isSpicy: { type: Boolean, default: false },

    // metrics & logistics
    calories: { type: Number, default: 0, min: 0 },
    sku: { type: String, trim: true },
    preparationTimeInMinutes: { type: Number, default: 10, min: 0 },

    // ingredients & addons
    ingredients: { type: [String], default: [] },
    addons: { type: [addonSchema], default: [] },

    // pricing
    isSizedBased: { type: Boolean, default: false },
    sizes: { type: [sizeSchema], default: [] }, // used when isSizedBased = true
    fixedPrice: { type: Number, default: 0, min: 0 }, // used when isSizedBased = false
    offeredPrice: { type: Number, default: null, min: 0 }, // optional promo price

    // discount object (optional)
    discount: { type: discountSchema, default: undefined },
  },
  { timestamps: true }
);

// Helpful compound index for lists within a section
menuItemSchema.index({ branchId: 1, sectionKey: 1, sortOrder: 1, nameEnglish: 1 });

export default model("MenuItem", menuItemSchema);
