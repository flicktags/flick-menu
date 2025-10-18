import mongoose from "mongoose";

const OrderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, unique: true, required: true }, // e.g., ORD-BR-000004-000001
    branchId: { type: String, required: true },                  // BR-000004
    currency: { type: String, required: true },                  // BHD
    qr: {
      type: { type: String },
      number: { type: String },
      qrId: { type: String },
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
    },
    remarks: String,
    source: String, // "customer_view"
    status: { type: String, default: "PENDING" },
    placedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export default mongoose.model("Order", OrderSchema);
