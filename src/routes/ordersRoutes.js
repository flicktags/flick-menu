// src/routes/ordersRoutes.js
import express from "express";
import { getOrders } from "../controllers/orderController.js";

import {
  createOrderStatusLookup,
  updateOrderStatusLookup,
  getOrderStatusLookups,
  getOrderStatusLookupById,
  deleteOrderStatusLookup,
} from "../controllers/orderStatusLookupController.js";

const router = express.Router();

// Protected vendor/admin orders API (summary + list by day)
router.get("/", getOrders);

// Optional compatibility path (e.g., /api/orders/summary)
router.get("/summary", getOrders);

// -------------------------------
// Order Status Lookup CRUD
// Base path: /api/orders/status-lookups
// -------------------------------
router.post("/status-lookups", createOrderStatusLookup);
router.get("/status-lookups", getOrderStatusLookups);
router.get("/status-lookups/:id", getOrderStatusLookupById);
router.put("/status-lookups/:id", updateOrderStatusLookup);
router.delete("/status-lookups/:id", deleteOrderStatusLookup);

export default router;


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

// import express from "express";
// import { getOrders } from "../controllers/orderController.js";

// const router = express.Router();

// // Protected vendor/admin orders API (summary + list by day)
// router.get("/", getOrders);

// // Optional compatibility path (e.g., /api/orders/summary)
// router.get("/summary", getOrders);

// export default router;
