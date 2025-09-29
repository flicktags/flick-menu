import mongoose from "mongoose";

const venueTypeCounterSchema = new mongoose.Schema({
  seq: { type: Number, default: 100 } // starting number
});

export default mongoose.model("VenueTypeCounter", venueTypeCounterSchema);
