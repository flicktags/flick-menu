import express from "express";
import  generateQr,  { getBranchQrs }  from "../controllers/qrCodeController.js";

const QrCodeRouter = express.Router();
QrCodeRouter.post("/generate", generateQr);
QrCodeRouter.get("/branch/:branchId", getBranchQrs);

export default QrCodeRouter;