import express from "express";
import { verifyFirebaseToken } from "../middlewares/authMiddleware.js";
import {
  createMenuItem,
  listMenuItems,
  getMenuItem,
  updateMenuItem,
  deleteMenuItem,
  setAvailability,
} from "../controllers/menuItemController.js";

const router = express.Router();

// All endpoints require Firebase auth
router.use(verifyFirebaseToken);

// Create
router.post("/items", createMenuItem);

// List (by branch, optional sectionKey)
router.get("/items", listMenuItems);

// Read one
router.get("/items/:id", getMenuItem);

// Update
router.patch("/items/:id", updateMenuItem);

// Quick availability toggle
router.patch("/items/:id/availability", setAvailability);

// Delete
router.delete("/items/:id", deleteMenuItem);

export default router;
