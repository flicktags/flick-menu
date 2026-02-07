// // // src/models/Order.js

// // src/models/Order.js
// src/models/Order.js
import mongoose from "mongoose";

const OrderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, unique: true, required: true },
    publicToken: { type: String, required: true, unique: true, index: true },
    branchId: { type: String, required: true },
    currency: { type: String, required: true },

    qr: {
      type: { type: String },
      number: { type: String },
      qrId: { type: String },
      label: { type: String },
    },

    customer: {
      name: { type: String },
      phone: { type: String },
    },

    items: [
      {
        itemId: String,
        nameEnglish: String,
        nameArabic: String,
        imageUrl: String,
        isSizedBased: Boolean,
        size: { label: String, price: Number },
        addons: [{ id: String, label: String, price: Number }],
        unitBasePrice: Number,
        quantity: Number,
        notes: String,
        lineTotal: Number,

        kdsStationKey: {
          type: String,
          default: "MAIN",
          uppercase: true,
          trim: true,
        },

        // ✅ NEW: station-level line status
        // This is what each station updates (NOT the whole order).
        kdsStatus: {
          type: String,
          enum: [
            "PENDING",
            "PREPARING",
            "READY",
            "SERVED",
            "COMPLETED",
            "CANCELLED",
            "REJECTED",
          ],
          default: "PENDING",
          uppercase: true,
          trim: true,
          index: true,
        },
        kdsStatusUpdatedAt: { type: Date, default: null },
        kdsStatusUpdatedBy: { type: String, default: null },

        // ✅ Out-of-stock per line
        availability: {
          type: String,
          enum: ["AVAILABLE", "OUT_OF_STOCK"],
          default: "AVAILABLE",
        },
        unavailableReason: { type: String, default: null },
        unavailableAt: { type: Date, default: null },
        unavailableBy: { type: String, default: null },
      },
    ],

    lastChange: {
      type: { type: String, default: null, index: true },
      at: { type: Date, default: null },
      by: { type: String, default: null },
      payload: { type: mongoose.Schema.Types.Mixed, default: null },
    },

    // pricing: {
    //   subtotal: Number,
    //   serviceChargePercent: Number,
    //   serviceChargeAmount: Number,
    //   vatPercent: Number,
    //   vatAmount: Number,
    //   grandTotal: Number,
    //   isVatInclusive: { type: Boolean, default: false },
    //   subtotalExVat: { type: Number, default: 0 },
    // },
    pricing: {
      subtotal: Number,
      serviceChargePercent: Number,
      serviceChargeAmount: Number,
      vatPercent: Number,
      vatAmount: Number,
      grandTotal: Number,
      isVatInclusive: { type: Boolean, default: false },
      subtotalExVat: { type: Number, default: 0 },

      // ✅ NEW: Platform Fee snapshot (stored per order)
      // platformFeePerOrderFils comes from branch.taxes.platformFeePerOrder (e.g. 80 fils)
      // platformFee is the applied value in BHD (e.g. 0.080)
      platformFeePerOrderFils: { type: Number, default: 0 },
      platformFee: { type: Number, default: 0 }, // BHD
      platformFeePaidByCustomer: { type: Boolean, default: false },
      showPlatformFee: { type: Boolean, default: true },
    },

    remarks: String,
    source: String,

    // ✅ order-level status remains (customer/admin uses it)
    status: { type: String, default: "PENDING", index: true },
    placedAt: { type: Date, default: Date.now },

    vendorId: { type: String, required: true, index: true },
    tokenNumber: { type: Number, index: true },
    clientCreatedAt: { type: Date, default: null, index: true },
    clientTzOffsetMinutes: { type: Number, default: null },

    revision: { type: Number, default: 0, index: true },
    kitchenCycle: { type: Number, default: 1, index: true },

    readyAt: { type: Date, default: null, index: true },
    servedAt: { type: Date, default: null, index: true },

    readyAtCycle: { type: Number, default: null, index: true },

    servedHistory: {
      type: [
        {
          kitchenCycle: Number,
          servedAt: Date,
          readyAt: Date,
          fromStatus: String,
          note: String,
        },
      ],
      default: [],
    },

    businessDayLocal: { type: String, index: true },
    businessDayStartUTC: { type: Date, index: true },
    businessDayEndUTC: { type: Date, index: true },
  },
  { timestamps: true },
);

OrderSchema.index({ orderNumber: 1 }, { unique: true });
OrderSchema.index({ vendorId: 1, branchId: 1, createdAt: -1 });
OrderSchema.index({ branchId: 1, createdAt: -1 });
OrderSchema.index({ status: 1, createdAt: -1 });
OrderSchema.index({ tokenNumber: 1, createdAt: -1 });
OrderSchema.index({ publicToken: 1 }, { unique: true });
OrderSchema.index({ branchId: 1, placedAt: -1, status: 1 });
OrderSchema.index({ branchId: 1, createdAt: -1, status: 1 });
OrderSchema.index({ branchId: 1, "pricing.platformFeePaidByCustomer": 1, createdAt: -1 });
OrderSchema.index({ branchId: 1, revision: -1 });
OrderSchema.index({ branchId: 1, status: 1, readyAt: 1 });
OrderSchema.index({ branchId: 1, status: 1, servedAt: 1 });
OrderSchema.index({ branchId: 1, readyAtCycle: 1, kitchenCycle: 1 });
OrderSchema.index({ branchId: 1, businessDayLocal: 1, createdAt: -1 });
OrderSchema.index({
  branchId: 1,
  businessDayStartUTC: 1,
  businessDayEndUTC: 1,
});

OrderSchema.index({ branchId: 1, "items.kdsStationKey": 1, createdAt: -1 });
OrderSchema.index({
  branchId: 1,
  "items.kdsStationKey": 1,
  status: 1,
  createdAt: -1,
});
OrderSchema.index({
  branchId: 1,
  "items.kdsStationKey": 1,
  "items.kdsStatus": 1,
  createdAt: -1,
});

export default mongoose.model("Order", OrderSchema);

// import mongoose from "mongoose";

// const OrderSchema = new mongoose.Schema(
//   {
//     orderNumber: { type: String, unique: true, required: true }, // e.g. 2025101923000040000004
//     publicToken: { type: String, required: true, unique: true, index: true },
//     branchId: { type: String, required: true }, // BR-000004
//     currency: { type: String, required: true }, // BHD

//     qr: {
//       type: { type: String }, // "table" | "room"
//       number: { type: String }, // e.g. "table-1"
//       qrId: { type: String },
//       label: { type: String },
//     },

//     customer: {
//       name: { type: String },
//       phone: { type: String },
//     },

//     items: [
//       {
//         itemId: String,
//         nameEnglish: String,
//         nameArabic: String,
//         imageUrl: String,
//         isSizedBased: Boolean,
//         size: { label: String, price: Number },
//         addons: [{ id: String, label: String, price: Number }],
//         unitBasePrice: Number,
//         quantity: Number,
//         notes: String,
//         lineTotal: Number,
//         kdsStationKey: { type: String, default: "MAIN", uppercase: true, trim: true},

//         // ✅ NEW: Out-of-stock support per line
//         availability: {
//           type: String,
//           enum: ["AVAILABLE", "OUT_OF_STOCK"],
//           default: "AVAILABLE",
//         },
//         unavailableReason: { type: String, default: null },
//         unavailableAt: { type: Date, default: null },
//         unavailableBy: { type: String, default: null },
//       },
//     ],

//     // ✅ Optional: so customer can show a banner once (based on revision change)
//     lastChange: {
//       type: {
//         type: String, // e.g. "ITEM_OUT_OF_STOCK"
//         default: null,
//         index: true,
//       },
//       at: { type: Date, default: null },
//       by: { type: String, default: null },
//       payload: { type: mongoose.Schema.Types.Mixed, default: null },
//     },
//     pricing: {
//       subtotal: Number,
//       serviceChargePercent: Number,
//       serviceChargeAmount: Number,
//       vatPercent: Number,
//       vatAmount: Number,
//       grandTotal: Number,
//       isVatInclusive: { type: Boolean, default: false },
//       subtotalExVat: { type: Number, default: 0 },
//     },

//     remarks: String,
//     source: String, // "customer_view"

//     status: { type: String, default: "PENDING", index: true }, // controller may override
//     placedAt: { type: Date, default: Date.now },

//     // ---- NEW FIELDS ----
//     vendorId: { type: String, required: true, index: true },
//     tokenNumber: { type: Number, index: true },
//     clientCreatedAt: { type: Date, default: null, index: true },
//     clientTzOffsetMinutes: { type: Number, default: null },

//     revision: { type: Number, default: 0, index: true },
//     kitchenCycle: { type: Number, default: 1, index: true },

//     readyAt: { type: Date, default: null, index: true },
//     servedAt: { type: Date, default: null, index: true },

//     // ✅ Needed because your controller uses readyAtCycle
//     readyAtCycle: { type: Number, default: null, index: true },

//     servedHistory: {
//       type: [
//         {
//           kitchenCycle: Number,
//           servedAt: Date,
//           readyAt: Date,
//           fromStatus: String,
//           note: String,
//         },
//       ],
//       default: [],
//     },

//     // ---- BUSINESS DAY SNAPSHOT (Operational day) ----
//     businessDayLocal: { type: String, index: true }, // "YYYY-MM-DD" in branch TZ
//     businessDayStartUTC: { type: Date, index: true },
//     businessDayEndUTC: { type: Date, index: true },
//   },
//   { timestamps: true },
// );

// // Helpful indexes for common queries
// OrderSchema.index({ orderNumber: 1 }, { unique: true });
// OrderSchema.index({ vendorId: 1, branchId: 1, createdAt: -1 });
// OrderSchema.index({ branchId: 1, createdAt: -1 });
// OrderSchema.index({ status: 1, createdAt: -1 });
// OrderSchema.index({ tokenNumber: 1, createdAt: -1 });
// OrderSchema.index({ publicToken: 1 }, { unique: true });
// OrderSchema.index({ branchId: 1, placedAt: -1, status: 1 });
// OrderSchema.index({ branchId: 1, createdAt: -1, status: 1 });
// OrderSchema.index({ branchId: 1, revision: -1 });
// OrderSchema.index({ branchId: 1, status: 1, readyAt: 1 });
// OrderSchema.index({ branchId: 1, status: 1, servedAt: 1 });
// OrderSchema.index({ branchId: 1, readyAtCycle: 1, kitchenCycle: 1 });
// OrderSchema.index({ branchId: 1, businessDayLocal: 1, createdAt: -1 });
// OrderSchema.index({
//   branchId: 1,
//   businessDayStartUTC: 1,
//   businessDayEndUTC: 1,
// });
// OrderSchema.index({ branchId: 1, "items.kdsStationKey": 1, createdAt: -1 });
// OrderSchema.index({ branchId: 1, "items.kdsStationKey": 1, status: 1, createdAt: -1 });

// export default mongoose.model("Order", OrderSchema);
