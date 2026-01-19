// src/routes/kdsRoutes.js
import express from "express";
import { verifyFirebaseToken } from "../middlewares/authMiddleware.js";
import { getKdsOverview, updateKdsOrderStatus } from "../controllers/kdsController.js";

const router = express.Router();

// All KDS endpoints must be protected
router.get("/overview", verifyFirebaseToken, getKdsOverview);
router.patch("/orders/:id/status", verifyFirebaseToken, updateKdsOrderStatus);

export default router;
