// utils/generateVendorId.js
import Counter from "../models/VendorId.js";

export const generateVendorId = async () => {
  const counter = await Counter.findOneAndUpdate(
    { name: "vendor" },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  // Ensure it’s always 8 digits with leading zeros if needed
  return `V${counter.seq.toString().padStart(6, "0")}`;
}; //
