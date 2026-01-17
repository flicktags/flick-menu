// // src/routes/publicMenuRoutes.js
// import express from "express";
// import {
//   getPublicMenu,
//   getPublicSectionItems,
// } from "../controllers/publicMenuController.js";
// import {
//   getPublicMenuTypes,
//   getPublicSectionItemsGrouped,
//   getPublicBranchCatalog,
// } from "../controllers/publicMenuController.js"; // same file if you added them there

// const router = express.Router();

// router.get("/menu", getPublicMenu); // existing
// router.get("/menu/sections", getPublicMenuTypes); // NEW
// router.get("/menu/items", getPublicSectionItems); // existing (now returns all fields)
// router.get("/menu/section-grouped", getPublicSectionItemsGrouped); // NEW
// router.get("/menu/catalog", getPublicBranchCatalog); // NEW

// export default router;
// src/routes/publicMenuRoutes.js
import express from "express";
import {
  getPublicMenu,
  getPublicSectionItems,
  getPublicMenuTypes,
  getPublicSectionItemsGrouped,
  getPublicBranchCatalog,
  getPublicGroupedTree, // ✅ NEW
  getPublicThemeMapping,
  getPublicThemeMappingAll,

} from "../controllers/publicMenuController.js";
import { createOrder, getPublicOrderById, getPublicOrderByToken,   addItemsToPublicOrder } from "../controllers/orderController.js";       // ✅ ADD


const router = express.Router();

// SAME base paths for both free-tier and QR-aware (premium) flows.
// These handlers now accept either ?branch=... OR ?qrId=... (and can include both).
router.get("/menu", getPublicMenu);
router.get("/menu/sections", getPublicMenuTypes);
router.get("/menu/items", getPublicSectionItems);
router.get("/menu/section-grouped", getPublicSectionItemsGrouped);
router.get("/menu/catalog", getPublicBranchCatalog);
router.get("/menu/grouped-tree", getPublicGroupedTree);
// ⬇️ NEW (no auth):
router.get("/menu/theme-mapping", getPublicThemeMapping);       // one section
router.get("/menu/theme-mapping/all", getPublicThemeMappingAll); // all sections
router.post("/orders", createOrder);
router.get("/orders/:id", getPublicOrderById);
router.get("/orders/token/:token", getPublicOrderByToken);
router.post("/orders/:id/add-items", addItemsToPublicOrder); // add more items to the on going order

export default router;
