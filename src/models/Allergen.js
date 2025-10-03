// models/Allergen.js
import mongoose from 'mongoose';

const AllergenSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true, // e.g., "nuts", "gluten"
    },
    label: {
      en: { type: String, required: true, trim: true },
      ar: { type: String, required: true, trim: true },
    },
    icon: { type: String, default: null }, // emoji or URL (optional)
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model('Allergen', AllergenSchema);
