import express from "express";
import  generateQr,  { getBranchQrs, deleteLatestQrs, getQrMenuSections,
  getQrSectionItems,
  getQrSectionItemsGrouped,
  getQrBranchCatalog }  from "../controllers/qrCodeController.js";

const QrCodeRouter = express.Router();
QrCodeRouter.post("/generate", generateQr);
QrCodeRouter.get("/branch/:branchId", getBranchQrs);
QrCodeRouter.post("/branch/:branchId/delete-latest", deleteLatestQrs);

QrCodeRouter.get("/menu/sections", getQrMenuSections);
QrCodeRouter.get("/menu/items", getQrSectionItems);
QrCodeRouter.get("/menu/section-grouped", getQrSectionItemsGrouped);
QrCodeRouter.get("/menu/catalog", getQrBranchCatalog);
export default QrCodeRouter;