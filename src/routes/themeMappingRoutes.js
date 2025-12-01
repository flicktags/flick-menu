// router/themeMappingRoutes.js
import express from "express";
import { verifyFirebaseToken } from "../middlewares/authMiddleware.js";
import {
  getThemeMappingVendor,
  upsertThemeMappingVendor,
} from "../controllers/themeMappingController.js";

const router = express.Router();

// Firebase-protected vendor endpoints
router.use(verifyFirebaseToken);

// GET /api/vendor/theme-mapping?vendorId=...&branch=...&sectionKey=...
router.get("/theme-mapping", getThemeMappingVendor);

// PUT /api/vendor/theme-mapping
router.put("/theme-mapping", upsertThemeMappingVendor);

export default router;
