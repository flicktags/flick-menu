import express from "express";
import { registerVendor } from "../controllers/authController.js";
import { registerBranch } from "../controllers/branchController.js";
const router = express.Router();

// Register new user after Firebase login
// router.post("/register", registerVendor);
router.post("/register", registerBranch);

export default router;