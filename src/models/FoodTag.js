// models/FoodTag.js
import mongoose from 'mongoose';

const FoodTagSchema = new mongoose.Schema(
  {
    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FoodTagGroup',
      required: true,
      index: true,
    },
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true, // e.g., "VEGAN", "SPICY", "BESTSELLER"
    },
    name: { type: String, required: true, trim: true },        // EN
    nameArabic: { type: String, trim: true },  // AR
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model('FoodTag', FoodTagSchema);
