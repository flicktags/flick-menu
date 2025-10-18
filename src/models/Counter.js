// src/models/Counter.js
import mongoose from "mongoose";

const CounterSchema = new mongoose.Schema(
  {
    // e.g. "ORD-BR-000004"
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
  },
  { timestamps: false, strict: true }
);

// ✅ Prevent OverwriteModelError when the file is imported multiple times
export default mongoose.models.Counter || mongoose.model("Counter", CounterSchema);
