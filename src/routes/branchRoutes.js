import express from "express";
import { registerBranch } from "../controllers/branchController.js";

const branchRouter = express.Router();
branchRouter.post("/register", registerBranch);

export default branchRouter;