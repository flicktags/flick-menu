// import express from "express";
// import {
//   getPublicMenu,
//   getPublicSectionItems,
// } from "../controllers/publicMenuController.js";
// import { createOrder } from "../controllers/orderController.js";

// const router = express.Router();

// router.get("/menu", getPublicMenu);
// router.get("/menu/items", getPublicSectionItems);
// router.post("/orders", createOrder);

// export default router;
// src/routes/publicRoutes.js
// src/routes/publicRoutes.js
import express from "express";
import {
  getPublicMenu,
  getPublicSectionItems,
} from "../controllers/publicMenuController.js";
import { createOrder } from "../controllers/orderController.js";

const router = express.Router();

router.get("/menu", getPublicMenu);
router.get("/menu/items", getPublicSectionItems);

// Public order placement (no token)
router.post("/orders", createOrder);

export default router;

