import mongoose from "mongoose";

const menuTypeSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, uppercase: true }, // e.g. BREAKFAST
    nameEnglish: { type: String, required: true, trim: true },
    nameArabic: { type: String, trim: true },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("MenuType", menuTypeSchema);
