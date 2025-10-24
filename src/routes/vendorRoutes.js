import express from "express";
import { registerVendor } from "../controllers/authController.js";
import { updateMyVendor } from "../controllers/vendorController.js";
import { verifyFirebaseToken } from "../middlewares/authMiddleware.js";

const vendorRouter = express.Router();
vendorRouter.post("/register", registerVendor);
router.patch("/profile", verifyFirebaseToken, updateMyVendor);


export default vendorRouter;