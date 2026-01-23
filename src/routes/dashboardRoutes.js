// routes/dashboardRoutes.js
import express from "express";
import { verifyFirebaseToken } from "../middlewares/authMiddleware.js";
import { getDashboardSummary } from "../controllers/dashboardController.js";

const router = express.Router();

// ✅ main endpoint
router.get("/summary", verifyFirebaseToken, getDashboardSummary);

// ✅ OPTIONAL alias (if you want super simple “specific date” endpoint)
// GET /api/dashboard/by-date?branchId=BR-000005&date=2026-01-23
router.get("/by-date", verifyFirebaseToken, (req, res, next) => {
  // force period=day
  req.query.period = req.query.period || "day";
  return getDashboardSummary(req, res, next);
});

export default router;

// import express from "express";
// import { verifyFirebaseToken } from "../middlewares/authMiddleware.js";
// import { getDashboardSummary } from "../controllers/dashboardController.js";

// const router = express.Router();

// router.get("/summary", verifyFirebaseToken, getDashboardSummary);

// export default router;
