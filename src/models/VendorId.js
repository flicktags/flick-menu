
import mongoose from "mongoose";

const counterSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true }, // e.g., "vendor"
  seq: { type: Number, default: 100099 } // start just before first ID
});

export default mongoose.model("Counter", counterSchema); //