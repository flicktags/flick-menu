// routes/LookupsAPI.js
import express from "express";
import {
  createVenueType,
  getVenueTypes,
  updateVenueType,
  // --- Allergens ---
  createAllergen,
  getAllergens,
  getAllergenById,
  getAllergenByKey,
  updateAllergen,
} from "../controllers/lookupController.js";
// If you want to protect POST/PUT with Firebase auth in the future:
// import { verifyFirebaseToken } from "../middleware/authMiddleware.js";

const router = express.Router();

/* ===== Venue Types ===== */
router.post("/venue-types", createVenueType);
router.get("/venue-types", getVenueTypes);
router.put("/venue-types/:id", updateVenueType);

/* ===== Allergens ===== */
// Public GETs
router.get("/allergens", getAllergens);
router.get("/allergens/:id", getAllergenById);
router.get("/allergens/by-key/:key", getAllergenByKey);

// Create / Update (optionally protect later)
// router.post("/allergens", verifyFirebaseToken, createAllergen);
// router.put("/allergens/:id", verifyFirebaseToken, updateAllergen);
router.post("/allergens", createAllergen);
router.put("/allergens/:id", updateAllergen);

export default router;
