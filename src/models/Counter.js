// // src/models/Counter.js
// import mongoose from "mongoose";

// const CounterSchema = new mongoose.Schema(
//   {
//     // single source of truth for the counter key
//     name: { type: String, unique: true, required: true, index: true },
//     seq: { type: Number, default: 0 },
//   },
//   { timestamps: false }
// );

// // Reuse if already compiled (prevents OverwriteModelError)
// const Counter =
//   mongoose.models.Counter || mongoose.model("Counter", CounterSchema);

// export async function nextSeq(name) {
//   const doc = await Counter.findOneAndUpdate(
//     { name },
//     { $inc: { seq: 1 } },
//     { new: true, upsert: true, setDefaultsOnInsert: true }
//   ).lean();
//   return doc.seq;
// }

// export default Counter;
// src/models/Counter.js
import mongoose from "mongoose";

const CounterSchema = new mongoose.Schema(
  {
    // Single source of truth per counter key
    name: { type: String, unique: true, required: true, index: true },
    seq: { type: Number, default: 0 },
  },
  { timestamps: false }
);

// Reuse compiled model (prevents OverwriteModelError)
const Counter =
  mongoose.models.Counter || mongoose.model("Counter", CounterSchema);

/** Generic monotonic counter */
export async function nextSeq(name) {
  const doc = await Counter.findOneAndUpdate(
    { name },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
  return doc.seq;
}

/** Build the per-day key for a vendor+branch */
export function dailyKeyForOrder(vendorId, branchId, ymd /* YYYY-MM-DD */) {
  return `orderDaily:${vendorId}:${branchId}:${ymd}`;
}

/** Per-day counter for orders (resets each calendar day for vendor+branch) */
export async function nextDailyOrderSeq(vendorId, branchId, ymd) {
  const name = dailyKeyForOrder(vendorId, branchId, ymd);
  const doc = await Counter.findOneAndUpdate(
    { name },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
  return doc.seq;
}

export default Counter;
