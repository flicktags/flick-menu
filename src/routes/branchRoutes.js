import express from "express";
import { registerBranch, listBranchesByVendor } from "../controllers/branchController.js";
import { verifyFirebaseToken } from '../middlewares/authMiddleware.js'


const branchRouter = express.Router();
branchRouter.post("/register", registerBranch);
// List branches (secured)
branchRouter.get("/vendor/:vendorId", verifyFirebaseToken, listBranchesByVendor);
// Also handy: GET /api/branches?vendorId=V000023
branchRouter.get("/", verifyFirebaseToken, listBranchesByVendor);

export default branchRouter;