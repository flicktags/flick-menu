// // src/routes/ordersRoutes.js
// import express from "express";
// import { getDailySummary } from "../controllers/orderController.js";

// const router = express.Router();

// // Protected admin/vendor summary
// router.get("/summary", getDailySummary);

// export default router;

// src/routes/ordersRoutes.js
// import express from "express";
// import { getOrders } from "../controllers/orderController.js";

// const router = express.Router();

// // Admin/vendor protected: list + summary with filters
// router.get("/", getOrders);

// export default router;

import express from "express";
import { getOrders } from "../controllers/orderController.js";

const router = express.Router();

// Protected vendor/admin orders API (summary + list)
router.get("/", getOrders);

// Optional compatibility path (if you were calling /api/orders/summary)
router.get("/summary", getOrders);

export default router;
