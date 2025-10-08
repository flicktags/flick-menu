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
  createFoodCategoryGroup,
  getFoodCategoryGroups,
  bulkCreateFoodCategories,
  getFoodCategories,
  createFoodTagGroup,
  getFoodTagGroups,
  bulkCreateFoodTags,
  getFoodTags,

    // ===== Menu Types =====
  listMenuTypes,
  createMenuType,
  updateMenuType,
  disableMenuType,
} from "../controllers/lookupController.js";
// If you want to protect POST/PUT with Firebase auth in the future:
// import { verifyFirebaseToken } from "../middleware/authMiddleware.js";

const router = express.Router();

/* ===== Venue Types ===== */
router.post("/venue-types", createVenueType);
router.get("/venue-types", getVenueTypes);
router.put("/venue-types/:id", updateVenueType);

// Public-style endpoints (no auth)
router.get("/menu-types", listMenuTypes);             // ?active=true to return only active
router.post("/menu-types", createMenuType);           // body: { key, nameEnglish, nameArabic?, sortOrder?, isActive? }
router.put("/menu-types/:id", updateMenuType);        // partial updates allowed (key will be normalized)
router.delete("/menu-types/:id", disableMenuType);    // soft-disable (sets isActive:false)


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

router.post("/food-category-groups", createFoodCategoryGroup);
router.get("/food-category-groups", getFoodCategoryGroups);

// Categories
router.post("/food-categories/bulk", bulkCreateFoodCategories);
router.get("/food-categories", getFoodCategories);

// ----- Food Tag Groups -----
router.post("/food-tag-groups", createFoodTagGroup);
router.get("/food-tag-groups", getFoodTagGroups);

// ----- Food Tags (bulk only, like categories) -----
router.post("/food-tags/bulk", bulkCreateFoodTags);
router.get("/food-tags", getFoodTags);

export default router;
