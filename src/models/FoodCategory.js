// models/FoodCategory.js
import mongoose from 'mongoose';

const FoodCategorySchema = new mongoose.Schema(
  {
    group: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodCategoryGroup', required: true },
    code:  { type: String, required: true, unique: true, uppercase: true, trim: true }, // e.g., BURGER
    name:  { type: String, required: true, trim: true },       // English
    nameArabic: { type: String, required: true, trim: true },  // Arabic
    icon: { type: String, default: null },                     // optional emoji or URL
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

FoodCategorySchema.index({ group: 1, order: 1 });
export default mongoose.model('FoodCategory', FoodCategorySchema);
