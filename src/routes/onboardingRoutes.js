// src/routes/onboardingRoutes.js
import express from "express";
import { verifyFirebaseToken } from "../middlewares/authMiddleware.js";
import { singleBranchOnboard } from "../controllers/onboardingController.js";

const router = express.Router();

// POST /api/onboarding/single-branch
router.post("/single-branch", verifyFirebaseToken, singleBranchOnboard);

export default router;
