import express from "express";
import { registerVendor } from "../controllers/authController.js";

const router = express.Router();

// Register new user after Firebase login
router.post("/register", registerVendor);

export default router;