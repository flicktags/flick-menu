// src/models/OrderStatusLookupModel.js
import mongoose from "mongoose";

const OrderStatusLookupSchema = new mongoose.Schema(
  {
    // Stable key used in orders.status (recommended: uppercase)
    code: { type: String, required: true, unique: true, index: true }, // e.g. "PENDING", "ACCEPTED"

    // Display labels (UI)
    nameEnglish: { type: String, required: true },
    nameArabic: { type: String, required: true },

    // Sort in UI
    sortOrder: { type: Number, default: 0, index: true },

    // Allow disable without deleting
    isEnabled: { type: Boolean, default: true, index: true },

    // Optional flags (useful later for KDS / business rules)
    isTerminal: { type: Boolean, default: false }, // e.g. COMPLETED/CANCELLED
    colorHex: { type: String, default: null },     // e.g. "#FF9900"
  },
  { timestamps: true }
);

// Normalize code
OrderStatusLookupSchema.pre("save", function (next) {
  if (this.code) this.code = String(this.code).trim().toUpperCase();
  next();
});

export default mongoose.model("OrderStatusLookup", OrderStatusLookupSchema);
