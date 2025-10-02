import admin from "../config/firebase.js";
import Branch from "../models/Branch.js";
import Vendor from "../models/Vendor.js";
import { generateBranchId } from "../utils/generateBranchId.js";

export const registerBranch = async (req, res) => {
  try {
    const {
      token,
      vendorId,
      nameEnglish,
      nameArabic,
      venueType,
      serviceFeatures,
      openingHours,
      contact,
      address,
      timeZone,
      currency,
      branding,
      taxes,
      qrSettings,
      subscription,
    } = req.body;

    if (!token) {
      return res.status(400).json({ message: "Firebase token required" });
    }

    // verify Firebase token
    const decodedToken = await admin.auth().verifyIdToken(token);
    const userId = decodedToken.uid;

    // check vendor exists
    const vendor = await Vendor.findOne({ vendorId });
    if (!vendor) {
      return res.status(404).json({ message: "Vendor not found" });
    }

    // generate branchId
    const branchId = await generateBranchId();

    // create branch
    const branch = await Branch.create({
      branchId,
      vendorId,
      userId,
      nameEnglish,
      nameArabic,
      venueType,
      serviceFeatures,
      openingHours,
      contact,
      address,
      timeZone,
      currency,
      branding,
      taxes,
      qrSettings,
      subscription,
    });

    res.status(201).json({ message: "Branch registered successfully", branch });
  } catch (error) {
    console.error("Branch Register Error:", error);
    res.status(500).json({ message: error.message });
  }
};
