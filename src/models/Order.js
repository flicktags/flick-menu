// src/models/Order.js
import mongoose from "mongoose";


const OrderSchema = new mongoose.Schema(
  {
    // Existing fields (unchanged)
    orderNumber: { type: String, unique: true, required: true }, // e.g. 2025101923000040000004
    publicToken: { type: String, required: true, unique: true, index: true },
    branchId: { type: String, required: true },                  // BR-000004
    currency: { type: String, required: true },                  // BHD
    qr: {
      type: { type: String },   // "table" | "room" (or similar)
      number: { type: String }, // e.g. "table-1"
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
      subtotalExVat: { type: Number, default: 0 }, // optional but useful for receipts
    },
    remarks: String,
    source: String, // "customer_view"
    status: { type: String, default: "PENDING", index: true }, // controller may override to "Pending"
    placedAt: { type: Date, default: Date.now },

    // ---- NEW FIELDS (added, not replacing anything) ----
    vendorId: { type: String, required: true, index: true }, // for ownership + summaries
    tokenNumber: { type: Number, index: true },              // small per-day token shown to customer
    clientCreatedAt: { type: Date, default: null, index: true }, // parsed from ISO sent by client
    clientTzOffsetMinutes: { type: Number, default: null }, 

    readyAt: { type: Date, default: null, index: true },  // set when status becomes "Ready"
    servedAt: { type: Date, default: null, index: true }, // set when status becomes "Served"
  },
  { timestamps: true }
);

// Helpful indexes for common queries
OrderSchema.index({ orderNumber: 1 }, { unique: true });
OrderSchema.index({ vendorId: 1, branchId: 1, createdAt: -1 });
OrderSchema.index({ branchId: 1, createdAt: -1 });
OrderSchema.index({ status: 1, createdAt: -1 });
OrderSchema.index({ tokenNumber: 1, createdAt: -1 });
OrderSchema.index({ publicToken: 1 }, { unique: true });
OrderSchema.index({ branchId: 1, placedAt: -1, status: 1 });
OrderSchema.index({ branchId: 1, createdAt: -1, status: 1 });



export default mongoose.model("Order", OrderSchema);

// import mongoose from "mongoose";

// const OrderSchema = new mongoose.Schema(
//   {
//     orderNumber: { type: String, unique: true, required: true }, // e.g., ORD-BR-000004-000001
//     branchId: { type: String, required: true },                  // BR-000004
//     currency: { type: String, required: true },                  // BHD
//     qr: {
//       type: { type: String },
//       number: { type: String },
//       qrId: { type: String },
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
//     },
//     remarks: String,
//     source: String, // "customer_view"
//     status: { type: String, default: "PENDING" },
//     placedAt: { type: Date, default: Date.now },
//   },
//   { timestamps: true }
// );

// export default mongoose.model("Order", OrderSchema);
