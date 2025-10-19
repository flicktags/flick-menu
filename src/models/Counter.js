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
// src/models/Counter.js
// src/models/Counter.js
// src/models/Counter.js
import mongoose from "mongoose";

const CounterSchema = new mongoose.Schema(
  {
    // Unique counter key, e.g. "qrcode", "orders:daily:V000023:BR-000004:20251019", "token:20251019:BR-000004"
    name: { type: String, unique: true, required: true, index: true },
    seq: { type: Number, default: 0 },
  },
  { timestamps: false, versionKey: false }
);

// Reuse compiled model to avoid OverwriteModelError
const Counter = mongoose.models.Counter || mongoose.model("Counter", CounterSchema);

export async function nextSeq(name) {
  const doc = await Counter.findOneAndUpdate(
    { name },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  ).lean();
  return doc.seq;
}
export async function nextSeqByKey(key) {
  return nextSeq(key);
}
// Still available if you need it elsewhere
export async function nextTokenForDay(ymd, branchBusinessId) {
  const key = `token:${ymd}:${branchBusinessId}`;
  return nextSeq(key);
}

export default Counter;



