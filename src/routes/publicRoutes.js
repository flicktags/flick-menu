// src/routes/publicMenuRoutes.js
import express from "express";
import {
  getPublicMenu,
  getPublicSectionItems,
} from "../controllers/publicMenuController.js";
import {
  getPublicMenuTypes,
  getPublicSectionItemsGrouped,
  getPublicBranchCatalog,
} from "../controllers/publicMenuController.js"; // same file if you added them there

const router = express.Router();

router.get("/menu", getPublicMenu); // existing
router.get("/menu/sections", getPublicMenuTypes); // NEW
router.get("/menu/items", getPublicSectionItems); // existing (now returns all fields)
router.get("/menu/section-grouped", getPublicSectionItemsGrouped); // NEW
router.get("/menu/catalog", getPublicBranchCatalog); // NEW

export default router;



// import express from "express";
// import {
//   getPublicMenu,
//   getPublicSectionItems,
// } from "../controllers/publicMenuController.js";
// import { createOrder } from "../controllers/orderController.js";

// const router = express.Router();

// router.get("/menu", getPublicMenu);
// router.get("/menu/items", getPublicSectionItems);

// // Public order placement (no token)
// router.post("/orders", createOrder);

// export default router;