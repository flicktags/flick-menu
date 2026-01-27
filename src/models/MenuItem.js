// // src/models/MenuItem.js
// import mongoose from "mongoose";

// const { Schema, model } = mongoose;

// const sizeSchema = new Schema(
//   { label: { type: String, required: true, trim: true }, price: { type: Number, required: true, min: 0 } },
//   { _id: false }
// );

// const discountSchema = new Schema(
//   { type: { type: String, enum: ["percentage", "amount"], required: true }, value: { type: Number, required: true, min: 0 }, validUntil: { type: Date } },
//   { _id: false }
// );

// const addonOptionSchema = new Schema(
//   { label: { type: String, required: true, trim: true }, price: { type: Number, default: 0, min: 0 }, sku: { type: String, trim: true }, isDefault: { type: Boolean, default: false } },
//   { _id: false }
// );

// const addonSchema = new Schema(
//   { label: { type: String, required: true, trim: true }, required: { type: Boolean, default: false }, min: { type: Number, default: 0 }, max: { type: Number, default: 1 }, options: { type: [addonOptionSchema], default: [] } },
//   { _id: false }
// );

// const menuItemSchema = new Schema(
//   {
//     branchId: { type: String, required: true, index: true },
//     vendorId: { type: String, required: true, index: true },

//     sectionKey: { type: String, required: true, uppercase: true, trim: true, index: true },
//     sortOrder: { type: Number, default: 0 },

//     itemType: { type: String, default: "", trim: true },
//     nameEnglish: { type: String, required: true, trim: true },
//     nameArabic: { type: String, required: true, trim: true },
//     description: { type: String, default: "" },
//     descriptionArabic: { type: String, default: "" },

//     imageUrl: { type: String, default: "" },
//     videoUrl: { type: String, default: "" },

//     allergens: { type: [String], default: [] },
//     tags: { type: [String], default: [] },

//     isFeatured: { type: Boolean, default: false },
//     isActive: { type: Boolean, default: true },
//     isAvailable: { type: Boolean, default: true },
//     isSpicy: { type: Boolean, default: false },

//     calories: { type: Number, default: 0, min: 0 },
//     sku: { type: String, trim: true },
//     preparationTimeInMinutes: { type: Number, default: 10, min: 0 },

//     ingredients: { type: [String], default: [] },
//     addons: { type: [addonSchema], default: [] },

//     isSizedBased: { type: Boolean, default: false },
//     sizes: { type: [sizeSchema], default: [] },
//     fixedPrice: { type: Number, default: 0, min: 0 },
//     offeredPrice: { type: Number, default: null, min: 0 },

//     discount: { type: discountSchema, default: undefined },
//   },
//   { timestamps: true }
// );

// menuItemSchema.index({ branchId: 1, sectionKey: 1, sortOrder: 1, nameEnglish: 1 });

// export default model("MenuItem", menuItemSchema);
// src/models/MenuItem.js
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
    branchId: { type: String, required: true, index: true },
    vendorId: { type: String, required: true, index: true },

    sectionKey: { type: String, required: true, uppercase: true, trim: true, index: true },
    sortOrder: { type: Number, default: 0 },

    itemType: { type: String, default: "", trim: true },
    nameEnglish: { type: String, required: true, trim: true },
    nameArabic: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    descriptionArabic: { type: String, default: "" },

    imageUrl: { type: String, default: "" },
    imagePublicId: { type: String, default: "", trim: true },

    videoUrl: { type: String, default: "" },

    allergens: { type: [String], default: [] },
    tags: { type: [String], default: [] },

    isFeatured: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    isAvailable: { type: Boolean, default: true },
    isSpicy: { type: Boolean, default: false },

    calories: { type: Number, default: 0, min: 0 },
    sku: { type: String, trim: true },
    preparationTimeInMinutes: { type: Number, default: 10, min: 0 },

    ingredients: { type: [String], default: [] },
    addons: { type: [addonSchema], default: [] },

    isSizedBased: { type: Boolean, default: false },
    sizes: { type: [sizeSchema], default: [] },
    fixedPrice: { type: Number, default: 0, min: 0 },

    // IMPORTANT: leave undefined (not null) when absent to avoid Number cast/min issues
    offeredPrice: { type: Number, min: 0, default: undefined },

    // discount subdoc should be undefined (absent) when not provided
    discount: { type: discountSchema, default: undefined },

    // ---------- NEW: Group-level category fields ----------
    foodCategoryGroupId:          { type: String, default: null, index: true },
    foodCategoryGroupCode:        { type: String, default: "", uppercase: true, trim: true, index: true },
    foodCategoryGroupNameEnglish: { type: String, default: "", trim: true },
    kdsStationKey: { type: String, default: "MAIN", uppercase: true, trim: true, index: true },

    // ------------------------------------------------------
  },
  { timestamps: true }
);

menuItemSchema.index({ branchId: 1, sectionKey: 1, sortOrder: 1, nameEnglish: 1 });
menuItemSchema.index({ sectionKey: 1, foodCategoryGroupCode: 1, isActive: 1 });

export default model("MenuItem", menuItemSchema);
