import express from "express";
import { createVenueType, getVenueTypes } from "../controllers/lookupController.js";

const router = express.Router();

// POST -> Save new VenueType
router.post("/venue-types", createVenueType);

// GET -> Fetch all VenueTypes
router.get("/venue-types", getVenueTypes);

export default router;
