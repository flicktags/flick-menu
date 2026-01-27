// src/routes/vendorStationRoutes.js
import express from "express";
import { verifyFirebaseToken } from "../middlewares/authMiddleware.js";
import {
  getStations,
  createStation,
  updateStation,
  deleteStation,
  reorderStations,
} from "../controllers/branchStationsController.js";

const router = express.Router();

// vendor secured
router.get("/vendor/branches/:branchId/stations", verifyFirebaseToken, getStations);
router.post("/vendor/branches/:branchId/stations", verifyFirebaseToken, createStation);
router.put("/vendor/branches/:branchId/stations/:key", verifyFirebaseToken, updateStation);
router.delete("/vendor/branches/:branchId/stations/:key", verifyFirebaseToken, deleteStation);
router.put("/vendor/branches/:branchId/stations/reorder", verifyFirebaseToken, reorderStations);

export default router;
