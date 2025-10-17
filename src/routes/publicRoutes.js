// src/routes/publicRoutes.js
import express from "express";
import { getPublicMenu } from "../controllers/publicMenuController.js";

const PublicRouter = express.Router();

// GET /api/public/menu?branch=BR-000004  OR  ?qrId=QR-000120
PublicRouter.get("/menu", getPublicMenu);

export default PublicRouter;
