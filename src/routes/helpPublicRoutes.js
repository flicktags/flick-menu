// src/routes/helpPublicRoutes.js
import express from "express";
import { callWaiter } from "../controllers/helpController.js";

const router = express.Router();

// Public endpoint (no auth)
router.post("/call-waiter", callWaiter);

export default router;
