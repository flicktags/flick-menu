import express from "express";
import { createVenueType, getVenueTypes, updateVenueType  } from "../controllers/lookupController.js";

const router = express.Router();

// POST -> Save new VenueType
router.post("/venue-types", createVenueType);

// GET -> Fetch all VenueTypes
router.get("/venue-types", getVenueTypes);

router.put("/venue-types/:id", updateVenueType);


export default router; ////
