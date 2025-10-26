import express from "express";
import { registerBranch, 
  listBranchesByVendor, 
  getBranchMenuSections,
  upsertBranchMenuSection,
  disableOrRemoveBranchMenuSection, 
  updateBranchInformation} from "../controllers/branchController.js";
import { verifyFirebaseToken } from '../middlewares/authMiddleware.js'


const branchRouter = express.Router();
branchRouter.post("/register", registerBranch);
// List branches (secured)
branchRouter.get("/vendor/:vendorId", verifyFirebaseToken, listBranchesByVendor);
// Also handy: GET /api/branches?vendorId=V000023
branchRouter.get("/", verifyFirebaseToken, listBranchesByVendor);
branchRouter.patch("/:branchId", verifyFirebaseToken, updateBranchInformation); // <-- NEW

// Menu sections per-branch
branchRouter.get("/:branchId/menu/sections", verifyFirebaseToken, getBranchMenuSections);
branchRouter.post("/:branchId/menu/sections", verifyFirebaseToken, upsertBranchMenuSection);
branchRouter.delete("/:branchId/menu/sections/:key", verifyFirebaseToken, disableOrRemoveBranchMenuSection);


export default branchRouter;