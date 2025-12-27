// routes/vendorCustomMenuTypesRoutes.js
import express from "express";
import {
  getCustomMenuTypes,
  createCustomMenuType,
  updateCustomMenuType,
  deleteCustomMenuType,
  reorderCustomMenuTypes,
} from "../controllers/branchCustomMenuTypesController.js";

// your firebase auth middleware (adjust path/name)
import { verifyFirebaseToken } from "../middlewares/authMiddleware.js";

const router = express.Router();

// ✅ Base: /api/vendor/branches/:branchId/custom-menu-types
router.get(
  "/branches/:branchId/custom-menu-types",
  verifyFirebaseToken,
  getCustomMenuTypes
);

router.post(
  "/branches/:branchId/custom-menu-types",
  verifyFirebaseToken,
  createCustomMenuType
);

router.put(
  "/branches/:branchId/custom-menu-types/:code",
  verifyFirebaseToken,
  updateCustomMenuType
);

router.delete(
  "/branches/:branchId/custom-menu-types/:code",
  verifyFirebaseToken,
  deleteCustomMenuType
);

// ✅ reorder
router.put(
  "/branches/:branchId/custom-menu-types/reorder",
  verifyFirebaseToken,
  reorderCustomMenuTypes
);

export default router;
