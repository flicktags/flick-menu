import express from "express";
import { verifyFirebaseToken } from "../middlewares/authMiddleware.js";
import { getDashboardSummary } from "../controllers/dashboardController.js";

const router = express.Router();

router.get("/summary", verifyFirebaseToken, getDashboardSummary);

export default router;
