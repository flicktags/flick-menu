// src/routes/ordersRoutes.js
import express from "express";
import { getDailySummary } from "../controllers/orderController.js";

const router = express.Router();

// Protected admin/vendor summary
router.get("/summary", getDailySummary);

export default router;
