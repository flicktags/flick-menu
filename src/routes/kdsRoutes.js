// src/routes/kdsRoutes.js
import express from "express";
import { verifyFirebaseToken } from "../middlewares/authMiddleware.js";
import {
  getKdsOverview,
  updateKdsOrderStatus,
  ackHelpRequest,updateKdsOrderItemAvailability
} from "../controllers/kdsController.js";

const router = express.Router();

// All KDS endpoints must be protected
router.get("/overview", verifyFirebaseToken, getKdsOverview);
router.patch("/orders/:id/status", verifyFirebaseToken, updateKdsOrderStatus);
router.patch("/help/:id/ack", verifyFirebaseToken, ackHelpRequest);
router.patch(
  "/api/kds/orders/:id/items/:lineId/availability",
  verifyFirebaseToken,
  updateKdsOrderItemAvailability,
);

export default router;
