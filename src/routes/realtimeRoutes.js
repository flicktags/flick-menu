import express from "express";
import { verifyFirebaseToken } from "../middlewares/authMiddleware.js";
import { createRealtimeTokenRequest } from "../controllers/realtimeController.js";

const router = express.Router();

// Protected: KDS app gets Ably token from backend
router.post("/auth", verifyFirebaseToken, createRealtimeTokenRequest);

export default router;