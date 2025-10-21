// import express from "express";
// import { registerVendor } from "../controllers/authController.js";
// import { registerBranch } from "../controllers/branchController.js";
// const router = express.Router();

// // Register new user after Firebase login
// router.post("/register", registerVendor);
// router.post("/register", registerBranch);

// export default router;
// src/routes/authRoute.js
import express from "express";
import { authBootstrap } from "../controllers/authController.js";
import { verifyFirebaseToken } from "../middleware/authMiddleware.js";

const router = express.Router();

// Branch/Vendor bootstrap
router.get("/bootstrap", verifyFirebaseToken, authBootstrap);

export default router;
