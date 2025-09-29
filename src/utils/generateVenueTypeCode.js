import VenueTypeCounter from "../models/VenueTypeCounter.js";

export const generateVenueTypeCode = async () => {
  const counter = await VenueTypeCounter.findOneAndUpdate(
    {},
    { $inc: { seq: 1 } },
    { new: true, upsert: true } // create if doesn't exist
  );

  // Prefix "VT" + counter value
  return `VT${counter.seq}`;
};
