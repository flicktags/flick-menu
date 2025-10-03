// models/FoodTagGroup.js
import mongoose from 'mongoose';

const FoodTagGroupSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true, // e.g., "DIET", "SPICE"
    },
    name: { type: String, required: true, trim: true },        // EN
    nameArabic: { type: String, trim: true },   // AR
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model('FoodTagGroup', FoodTagGroupSchema);
