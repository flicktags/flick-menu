// src/models/Counter.js
import mongoose from "mongoose";

const CounterSchema = new mongoose.Schema(
  {
    // Use a STRING key, e.g. "ORD-BR-000004"
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
  },
  { timestamps: false, versionKey: false, strict: true }
);

const MODEL_NAME = "Counter";

// If an older compiled model exists with a different _id type (ObjectId), remove it.
if (mongoose.models[MODEL_NAME]) {
  const existing = mongoose.models[MODEL_NAME];
  const idPath = existing.schema.path("_id");
  const isStringId = idPath && idPath.instance === "String";
  if (!isStringId) {
    delete mongoose.connection.models[MODEL_NAME];
  }
}

const Counter =
  mongoose.models[MODEL_NAME] || mongoose.model(MODEL_NAME, CounterSchema);

export default Counter;

// Optional helper to get the next sequence atomically
export async function nextSeq(counterId) {
  const res = await Counter.findOneAndUpdate(
    { _id: counterId },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true, lean: true }
  );
  return res.seq;
}
