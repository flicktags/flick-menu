// routes/menuItemRoutes.js
import express from "express";
import { verifyFirebaseToken } from "../middlewares/authMiddleware.js";
import {
  createMenuItem,
  listMenuItems,
  getMenuItem,
  updateMenuItem,
  deleteMenuItem,
} from "../controllers/menuItemController.js";

const router = express.Router();

// All endpoints require Firebase auth
router.use(verifyFirebaseToken);
router.post("/", createMenuItem);

// List (branchId required in query; sectionKey/isActive optional)
router.get("/", listMenuItems);

// Read one
router.get("/:id", getMenuItem);

// Update
router.patch("/:id", updateMenuItem);

// Delete
router.delete("/:id", deleteMenuItem);

export default router;
