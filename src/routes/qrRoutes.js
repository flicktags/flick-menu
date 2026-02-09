// import express from "express";
// import  generateQr,  { getBranchQrs, deleteLatestQrs, getQrMenuSections,
//   getQrSectionItems,
//   getQrSectionItemsGrouped,
//   getQrBranchCatalog }  from "../controllers/qrCodeController.js";

// const QrCodeRouter = express.Router();
// QrCodeRouter.post("/generate", generateQr);
// QrCodeRouter.get("/branch/:branchId", getBranchQrs);
// QrCodeRouter.post("/branch/:branchId/delete-latest", deleteLatestQrs);

// QrCodeRouter.get("/menu/sections", getQrMenuSections);
// QrCodeRouter.get("/menu/items", getQrSectionItems);
// QrCodeRouter.get("/menu/section-grouped", getQrSectionItemsGrouped);
// QrCodeRouter.get("/menu/catalog", getQrBranchCatalog);
// export default QrCodeRouter;

// src/routes/qrRoutes.js
import express from "express";
import generateQr, { getBranchQrs, deleteLatestQrs, generateCustomQrs } from "../controllers/qrCodeController.js";

const QrCodeRouter = express.Router();

// Admin/owner/manager operations
QrCodeRouter.post("/generate", generateQr);
QrCodeRouter.get("/branch/:branchId", getBranchQrs);
QrCodeRouter.post("/branch/:branchId/delete-latest", deleteLatestQrs);
QrCodeRouter.post("/generate-custom", generateCustomQrs);


export default QrCodeRouter;