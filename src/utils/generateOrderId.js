// utils/generateOrderId.js
import mongoose from "mongoose";

const CounterSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true },
    seq: { type: Number, default: 0 },
  },
  { collection: "counters" }
);

const Counter = mongoose.models.Counter || mongoose.model("Counter", CounterSchema);

export async function generateOrderId() {
  const c = await Counter.findOneAndUpdate(
    { key: "orders" },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  const seq = Number(c?.seq || 1);
  return `ORD-${String(seq).padStart(6, "0")}`;
}
