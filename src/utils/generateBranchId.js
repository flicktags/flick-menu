import Counter from "../models/VendorId.js";

export const generateBranchId = async () => {
  const counter = await Counter.findOneAndUpdate(
    { name: "branch" },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  // BR-000001 style
  return `BR-${counter.seq.toString().padStart(6, "0")}`;
};
