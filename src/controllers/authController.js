import admin from "../config/firebase.js";
import Vendor from "../models/Venndor.js";

// util: generate sequential vendor ID
let vendorCounter = 100100;
const generateVendorId = () => `v${++vendorCounter}`;
 
export const registerVendor = async (req, res) => {
  try {
    const { token, businessName, brandName, venueType, contactPhone, email, country, state, city, logoUrl, billing, features } = req.body;

    if (!token) {
      return res.status(400).json({ message: "Firebase token required" });
    }

    // verify Firebase token
    const decodedToken = await admin.auth().verifyIdToken(token);
    const userId = decodedToken.uid;

    // check if vendor already exists for this user
    const existingVendor = await Vendor.findOne({ userId });
    if (existingVendor) {
      return res.status(200).json({ message: "Vendor already registered", vendor: existingVendor });
    }

    // create new vendor
    const vendor = await Vendor.create({
      userId,
      vendorId: generateVendorId(),
      businessName,
      brandName,
      venueType,
      contactPhone,
      email,
      country,
      state,
      city,
      logoUrl,
      billing,
      features,
    });

    res.status(201).json({ message: "Vendor registered successfully", vendor });
  } catch (error) {
    console.error("Vendor Register Error:", error);
    res.status(500).json({ message: error.message });
  }
};
