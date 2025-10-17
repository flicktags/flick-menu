import express from "express";
import  generateQr,  { getBranchQrs, deleteLatestQrs }  from "../controllers/qrCodeController.js";

const QrCodeRouter = express.Router();
QrCodeRouter.post("/generate", generateQr);
QrCodeRouter.get("/branch/:branchId", getBranchQrs);
QrCodeRouter.post("/branch/:branchId/delete-latest", deleteLatestQrs);


export default QrCodeRouter;