import express from "express";
import  generateQr  from "../controllers/qrCodeController.js";

const QrCodeRouter = express.Router();
QrCodeRouter.post("/generate", generateQr);

export default QrCodeRouter;