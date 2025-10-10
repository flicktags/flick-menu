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

/**
 * Base path should be mounted as:
 *   app.use("/api/menu-items", router);
 * So final URLs:
 *   POST   /api/menu-items           (create; branchId + sectionKey in BODY)
 *   GET    /api/menu-items           (list; ?branchId=...&sectionKey=...&isActive=true)
 *   GET    /api/menu-items/:id       (read one)
 *   PATCH  /api/menu-items/:id       (update)
 *   DELETE /api/menu-items/:id       (delete)
 */

// Create (BODY must include branchId + sectionKey)
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
