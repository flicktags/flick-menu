// models/Order.js
import mongoose from "mongoose";

const AddonSchema = new mongoose.Schema(
  {
    id: String,
    label: String,
    price: { type: Number, default: 0 }, // per-unit addon price
  },
  { _id: false }
);

const OrderItemSchema = new mongoose.Schema(
  {
    itemId: String,
    nameEnglish: String,
    nameArabic: String,
    imageUrl: String,

    isSizedBased: { type: Boolean, default: false },
    size: {
      label: { type: String, default: null },
      price: { type: Number, default: null }, // per-unit base if sized
    },

    addons: { type: [AddonSchema], default: [] }, // per-unit addons
    unitBasePrice: { type: Number, required: true }, // base per-unit (size or fixed)
    addonsUnitTotal: { type: Number, required: true }, // sum of per-unit addons
    unitTotal: { type: Number, required: true }, // unitBasePrice + addonsUnitTotal

    quantity: { type: Number, required: true, min: 1 },
    notes: { type: String, default: null },

    lineTotal: { type: Number, required: true }, // unitTotal * quantity
  },
  { _id: false }
);

const OrderSchema = new mongoose.Schema(
  {
    orderId: { type: String, unique: true, index: true }, // e.g., ORD-000001
    status: {
      type: String,
      enum: ["pending", "accepted", "preparing", "ready", "served", "rejected", "cancelled", "completed"],
      default: "pending",
      index: true,
    },

    // Branch/Vendor
    branchObjectId: { type: String, required: true, index: true }, // Mongo _id as string
    branchBusinessId: { type: String, required: true, index: true }, // BR-000xxx
    vendorId: { type: String, required: true, index: true },

    // QR context (useful for table/room orders)
    qr: {
      type: {
        type: String, // "table" | "room" | etc
      },
      number: String, // "table-9"
      qrId: String,
    },

    currency: { type: String, default: "BHD" },

    customer: {
      name: { type: String, default: null },
      phone: { type: String, default: null },
    },

    items: { type: [OrderItemSchema], default: [] },

    pricing: {
      subtotal: { type: Number, default: 0 },
      serviceChargePercent: { type: Number, default: 0 },
      serviceChargeAmount: { type: Number, default: 0 },
      vatPercent: { type: Number, default: 0 },
      vatAmount: { type: Number, default: 0 },
      grandTotal: { type: Number, default: 0 },
    },

    remarks: { type: String, default: null },
    source: { type: String, default: "customer_view" },
  },
  { timestamps: true }
);

export default mongoose.model("Order", OrderSchema);
