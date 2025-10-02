import VenueTypeCounter from "../models/VenueTypeCounter.js";

export const generateVenueTypeCode = async () => {
  let counter = await VenueTypeCounter.findOne();
  
  if (!counter) {
    // Create initial counter if none exists
    counter = await VenueTypeCounter.create({ seq: 100 });
  } else {
    counter.seq += 1;
    await counter.save();
  }

  return `VT${counter.seq}`; ////
};
