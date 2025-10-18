// Simple counter collection for sequences like order numbers
import mongoose from "mongoose";

const CounterSchema = new mongoose.Schema(
  {
    // e.g. "ORD-BR-000004"
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
  },
  { timestamps: false, strict: true }
);

export default mongoose.model("Counter", CounterSchema);
