import express from "express";
import { verifyFirebaseToken } from "../middlewares/authMiddleware.js";
import {
  createMenuItem,
  listMenuItems,
  getMenuItemById,
  updateMenuItem,
  deleteMenuItem,
} from "../controllers/menuItemController.js";

const menuItemRouter = express.Router();

// Create in a specific branch/section
menuItemRouter.post(
  "/branches/:branchId/sections/:sectionKey/items",
  verifyFirebaseToken,
  createMenuItem
);

// List (by branch and/or section) — supports ?page=&limit=&isActive=
menuItemRouter.get(
  "/branches/:branchId/sections/:sectionKey/items",
  verifyFirebaseToken,
  listMenuItems
);
menuItemRouter.get(
  "/branches/:branchId/items",
  verifyFirebaseToken,
  listMenuItems
);

// Single item CRUD
menuItemRouter.get("/items/:id", verifyFirebaseToken, getMenuItemById);
menuItemRouter.patch("/items/:id", verifyFirebaseToken, updateMenuItem);
menuItemRouter.delete("/items/:id", verifyFirebaseToken, deleteMenuItem);

export default menuItemRouter;
