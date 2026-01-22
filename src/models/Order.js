// src/models/Order.js
import mongoose from "mongoose";

// ----- sub schemas -----
const CycleItemSchema = new mongoose.Schema(
  {
    lineId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },

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

    // ✅ per item kitchen state (truth for KDS)
    kitchenStatus: { type: String, default: "PENDING", index: true }, // PENDING/PREPARING/READY/SERVED
    readyAt: { type: Date, default: null },
    servedAt: { type: Date, default: null },
  },
  { _id: false }
);

const KitchenCycleSchema = new mongoose.Schema(
  {
    cycle: { type: Number, required: true, index: true },
    status: { type: String, default: "PENDING", index: true }, // PENDING/PREPARING/READY/SERVED

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    readyAt: { type: Date, default: null },
    servedAt: { type: Date, default: null },

    items: { type: [CycleItemSchema], default: [] },
  },
  { _id: false }
);

// ----- order schema -----
const OrderSchema = new mongoose.Schema(
  {
    // Existing fields (unchanged)
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

    // ✅ legacy flat items (keep for backward compatibility)
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
      },
    ],

    pricing: {
      subtotal: Number,
      serviceChargePercent: Number,
      serviceChargeAmount: Number,
      vatPercent: Number,
      vatAmount: Number,
      grandTotal: Number,
      isVatInclusive: { type: Boolean, default: false },
      subtotalExVat: { type: Number, default: 0 },
    },

    remarks: String,
    source: String,
    status: { type: String, default: "PENDING", index: true }, // overall (computed/maintained)
    placedAt: { type: Date, default: Date.now },

    vendorId: { type: String, required: true, index: true },
    tokenNumber: { type: Number, index: true },
    clientCreatedAt: { type: Date, default: null, index: true },
    clientTzOffsetMinutes: { type: Number, default: null },

    revision: { type: Number, default: 0, index: true },

    // ✅ Option A
    kitchenCycle: { type: Number, default: 1, index: true }, // current cycle
    kitchenCycles: { type: [KitchenCycleSchema], default: [] },

    // keep your timestamps (overall - optional)
    readyAt: { type: Date, default: null, index: true },
    servedAt: { type: Date, default: null, index: true },

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
  },
  { timestamps: true }
);

// Helpful indexes
OrderSchema.index({ orderNumber: 1 }, { unique: true });
OrderSchema.index({ vendorId: 1, branchId: 1, createdAt: -1 });
OrderSchema.index({ branchId: 1, createdAt: -1 });
OrderSchema.index({ status: 1, createdAt: -1 });
OrderSchema.index({ tokenNumber: 1, createdAt: -1 });
OrderSchema.index({ publicToken: 1 }, { unique: true });
OrderSchema.index({ branchId: 1, placedAt: -1, status: 1 });
OrderSchema.index({ branchId: 1, createdAt: -1, status: 1 });
OrderSchema.index({ branchId: 1, revision: -1 });
OrderSchema.index({ branchId: 1, status: 1, readyAt: 1 });
OrderSchema.index({ branchId: 1, status: 1, servedAt: 1 });

export default mongoose.model("Order", OrderSchema);


// // src/models/Order.js
// import mongoose from "mongoose";


// const OrderSchema = new mongoose.Schema(
//   {
//     // Existing fields (unchanged)
//     orderNumber: { type: String, unique: true, required: true }, // e.g. 2025101923000040000004
//     publicToken: { type: String, required: true, unique: true, index: true },
//     branchId: { type: String, required: true },                  // BR-000004
//     currency: { type: String, required: true },                  // BHD
//     qr: {
//       type: { type: String },   // "table" | "room" (or similar)
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
//       },
//     ],
//     pricing: {
//       subtotal: Number,
//       serviceChargePercent: Number,
//       serviceChargeAmount: Number,
//       vatPercent: Number,
//       vatAmount: Number,
//       grandTotal: Number,
//       isVatInclusive: { type: Boolean, default: false },
//       subtotalExVat: { type: Number, default: 0 }, // optional but useful for receipts
//     },
//     remarks: String,
//     source: String, // "customer_view"
//     status: { type: String, default: "PENDING", index: true }, // controller may override to "Pending"
//     placedAt: { type: Date, default: Date.now },

//     // ---- NEW FIELDS (added, not replacing anything) ----
//     vendorId: { type: String, required: true, index: true }, // for ownership + summaries
//     tokenNumber: { type: Number, index: true },              // small per-day token shown to customer
//     clientCreatedAt: { type: Date, default: null, index: true }, // parsed from ISO sent by client
//     clientTzOffsetMinutes: { type: Number, default: null }, 

//     revision: { type: Number, default: 0, index: true }, // increments on meaningful changes (add-more, status moves)
//     kitchenCycle: { type: Number, default: 1, index: true }, // “round” counter when reopened after SERVED
//     readyAt: { type: Date, default: null, index: true },  // set when status becomes "Ready"
//     servedAt: { type: Date, default: null, index: true }, // set when status becomes "Served"

//     servedHistory: {
//       type: [
//         {
//            kitchenCycle: Number,
//             servedAt: Date,
//             readyAt: Date,
//             fromStatus: String,
//             note: String,
//         },
//         ],
//         default: [],
//     },

//   },
//   { timestamps: true }
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


// export default mongoose.model("Order", OrderSchema);

