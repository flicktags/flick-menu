import Lookup from "../models/Lookup.js"; //
import { generateVenueTypeCode } from "../utils/generateVenueTypeCode.js"; //

// @desc Save a new VenueType lookup
// @route POST /api/lookups/venue-types
// @access Private (admin use ideally) //
export const createVenueType = async (req, res) => {
  try {
    const { nameEnglish, nameArabic } = req.body;

    if (!nameEnglish) {
      return res.status(400).json({ message: "English name is required" });
    }

    // Auto-generate code
    const code = await generateVenueTypeCode();

    const lookup = await Lookup.create({
      type: "venueType",
      code,
      nameEnglish,
      nameArabic,
    });

    res.status(201).json({ message: "Venue type created", lookup });
  } catch (error) {
    console.error("Create VenueType Error:", error);
    res.status(500).json({ message: error.message });
  }
};

// @desc Get all VenueTypes
// @route GET /api/lookups/venue-types
// @access Public
export const getVenueTypes = async (req, res) => {
  try {
    const lookups = await Lookup.find({ type: "venueType", isActive: true });
    res.status(200).json(lookups);
  } catch (error) {
    console.error("Get VenueTypes Error:", error);
    res.status(500).json({ message: error.message });
  }
};

// @desc Update a VenueType lookup
// @route PUT /api/lookups/venue-types/:id
// @access Private (admin)
export const updateVenueType = async (req, res) => {
  try {
    const { id } = req.params;
    const { nameEnglish, nameArabic, isActive } = req.body;

    const lookup = await Lookup.findById(id);
    if (!lookup) {
      return res.status(404).json({ message: "Venue type not found" });
    }

    // Update fields if provided (code is NOT editable)
    if (nameEnglish !== undefined) lookup.nameEnglish = nameEnglish;
    if (nameArabic !== undefined) lookup.nameArabic = nameArabic;
    if (isActive !== undefined) lookup.isActive = isActive;

    await lookup.save();

    res.status(200).json({ message: "Venue type updated", lookup });
  } catch (error) {
    console.error("Update VenueType Error:", error);
    res.status(500).json({ message: error.message });
  }
};
