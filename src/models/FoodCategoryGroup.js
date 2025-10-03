// models/FoodCategoryGroup.js
import mongoose from 'mongoose';

const FoodCategoryGroupSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true }, // e.g., MAIN
    name: { type: String, required: true, trim: true },        // English
    nameArabic: { type: String, required: true, trim: true },  // Arabic
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model('FoodCategoryGroup', FoodCategoryGroupSchema);
