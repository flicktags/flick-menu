// ===============================
// ✅ ROUTES: Wallet + Ledger
// File: src/routes/walletRoutes.js
// ===============================
import express from "express";
import { verifyFirebaseToken } from "../middlewares/authMiddleware.js";

import {
  getWalletSummary,
  getLedger,
  manualTopup,
  updateWalletSettings,
  debitOnOrderAccept,
} from "../controllers/walletController.js";

const router = express.Router();

// Vendor/Admin panel routes (protected with your Firebase token middleware)
router.get("/summary", verifyFirebaseToken, getWalletSummary);
router.get("/ledger", verifyFirebaseToken, getLedger);
router.post("/topup/manual", verifyFirebaseToken, manualTopup);
router.post("/settings", verifyFirebaseToken, updateWalletSettings);

// System debit route (also protected — called by your accept-order API)
router.post("/debit-on-accept", verifyFirebaseToken, debitOnOrderAccept);

export default router;
