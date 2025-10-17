// src/routes/publicRoutes.js
import express from "express";
import {
  getPublicMenu,
  getPublicSectionItems,
} from "../controllers/publicMenuController.js";

const router = express.Router();

router.get("/menu", getPublicMenu);
router.get("/menu/items", getPublicSectionItems);

export default router;
