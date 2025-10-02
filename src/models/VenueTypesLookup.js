const mongoose = require('mongoose');

const VenueTypesLookupSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
  },
  nameArabic: {
    type: String,
    required: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  }
}, { timestamps: true });

module.exports = mongoose.model('VenueTypesLookup', VenueTypesLookupSchema); //