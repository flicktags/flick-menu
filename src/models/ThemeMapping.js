// model/ThemeMapping.js
import mongoose from "mongoose";

const { Schema, model } = mongoose;

/**
 * One document per (vendorId, branchId, sectionKey).
 * itemTypeDesignMap is a Map<String,String> with values "01".."08".
 */
const ThemeMappingSchema = new Schema(
  {
    vendorId:   { type: String, required: true, index: true, trim: true },
    branchId:   { type: String, required: true, index: true, trim: true },
    sectionKey: { type: String, required: true, index: true, trim: true, uppercase: true },

    // Map of itemType -> designCode ("01".."08")
    itemTypeDesignMap: {
      type: Map,
      of: String,
      default: {},
    },
  },
  { timestamps: true }
);

// Enforce unique mapping per (vendor, branch, section)
ThemeMappingSchema.index({ vendorId: 1, branchId: 1, sectionKey: 1 }, { unique: true });


export default model("ThemeMapping", ThemeMappingSchema);
