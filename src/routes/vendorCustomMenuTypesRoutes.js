// routes/vendorCustomMenuTypesRoutes.js
import express from "express";
import {
  getCustomMenuTypes,
  createCustomMenuType,
  updateCustomMenuType,
  deleteCustomMenuType,
  reorderCustomMenuTypes,
} from "../controller/branchCustomMenuTypesController.js";

// your firebase auth middleware (adjust path/name)
import { requireFirebaseAuth } from "../middleware/requireFirebaseAuth.js";

const router = express.Router();

// ✅ Base: /api/vendor/branches/:branchId/custom-menu-types
router.get(
  "/branches/:branchId/custom-menu-types",
  requireFirebaseAuth,
  getCustomMenuTypes
);

router.post(
  "/branches/:branchId/custom-menu-types",
  requireFirebaseAuth,
  createCustomMenuType
);

router.put(
  "/branches/:branchId/custom-menu-types/:code",
  requireFirebaseAuth,
  updateCustomMenuType
);

router.delete(
  "/branches/:branchId/custom-menu-types/:code",
  requireFirebaseAuth,
  deleteCustomMenuType
);

// ✅ reorder
router.put(
  "/branches/:branchId/custom-menu-types/reorder",
  requireFirebaseAuth,
  reorderCustomMenuTypes
);

export default router;
