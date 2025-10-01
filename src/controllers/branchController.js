import admin from "../config/firebase.js";
import Branch from "../models/Brannch.js";
import Vendor from "../models/Venndor.js";

export const registerBranch = async (req, res) => {
  try {
    const { token, vendorId, businessName, brandName, venueType, qrCount, branchPhone, branchEmail, country, state, city, addressLine, timezone, currency, hours } = req.body;

    if (!token) {
      return res.status(400).json({ message: "Firebase token required" });
    }

    // verify Firebase token
    const decodedToken = await admin.auth().verifyIdToken(token);
    const userId = decodedToken.uid;

    // check if vendor exists
    const vendor = await Vendor.findOne({ vendorId });
    if (!vendor) {
      return res.status(404).json({ message: "Vendor not found" });
    }

    // create branch
    const branch = await Branch.create({
      vendorId,
      userId,
      businessName,
      brandName,
      venueType,
      qrCount,
      branchPhone,
      branchEmail,
      country,
      state,
      city,
      addressLine,
      timezone,
      currency,
      hours,
    });

    res.status(201).json({ message: "Branch registered successfully", branch });
  } catch (error) {
    console.error("Branch Register Error:", error);
    res.status(500).json({ message: error.message }); //
  }
};
