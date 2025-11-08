// src/routes/qrMenuRoutes.js
import express from "express";
import {
  getQrMenuSections,
  getQrSectionItems,
  getQrSectionItemsGrouped,
  getQrBranchCatalog,
} from "../controllers/publicMenuController.js";

const router = express.Router();

// Same shapes as public endpoints, plus `qr` in the response.
router.get("/menu/sections", getQrMenuSections);
router.get("/menu/items", getQrSectionItems);
router.get("/menu/section-grouped", getQrSectionItemsGrouped);
router.get("/menu/catalog", getQrBranchCatalog);

export default router;
