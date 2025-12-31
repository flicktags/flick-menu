// utils/generateVendorId.js
import Counter from "../models/VendorId.js";

// V000001
export const generateVendorId = async () => {
  const counter = await Counter.findOneAndUpdate(
    { name: "vendor" },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  return `V${counter.seq.toString().padStart(6, "0")}`;
};

// BR-000001
export const generateBranchId = async () => {
  const counter = await Counter.findOneAndUpdate(
    { name: "branch" },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  return `BR-${counter.seq.toString().padStart(6, "0")}`;
};

// // utils/generateVendorId.js
// import Counter from "../models/VendorId.js";

// export const generateVendorId = async () => {
//   const counter = await Counter.findOneAndUpdate(
//     { name: "vendor" },
//     { $inc: { seq: 1 } },
//     { new: true, upsert: true }
//   );

//   // Ensure it’s always 8 digits with leading zeros if needed
//   return `V${counter.seq.toString().padStart(6, "0")}`;
// }; //
