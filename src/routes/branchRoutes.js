import express from "express";
import { registerBranch, listBranchesByVendor } from "../controllers/branchController.js";
import { verifyFirebaseToken } from "../middleware/authMiddleware.js";


const branchRouter = express.Router();
branchRouter.post("/register", registerBranch);
router.get("/vendor/:vendorId", verifyFirebaseToken, listBranchesByVendor); // /api/branches/vendor/V000023

export default branchRouter;