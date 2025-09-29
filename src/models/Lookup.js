import mongoose from "mongoose";

const lookupSchema = new mongoose.Schema(
  {
    type: { type: String, required: true },
    code: { type: String },
    nameEnglish: { type: String, required: true }, 
    nameArabic: { type: String},  
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Index for faster lookup by type
lookupSchema.index({ type: 1 });

export default mongoose.model("Lookup", lookupSchema);
