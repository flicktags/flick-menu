// import express from "express";
// import { registerVendor } from "../controllers/authController.js";

// const vendorRouter = express.Router();
// vendorRouter.post("/register", registerVendor);

// export default vendorRouter;
// routes/vendorRoute.js
import express from "express";
import { registerVendor } from "../controllers/authController.js";

const vendorRouter = express.Router();

// POST /api/vendor/register
vendorRouter.post("/register", registerVendor);

export default vendorRouter;
