import admin from "../config/firebase.js";
import User from "../models/User.js";
import { v4 as uuidv4 } from "uuid";
import slugify from "slugify";

// @desc Register a user with Firebase UID + extra details (including vendor info)
// @route POST /api/auth/register
// @access Public (must send valid Firebase token)
export const registerVendor = async (req, res) => {
  try {
    const {
      token,
      hotelName,
      designation,
      role,

      // Vendor-related fields
      nameEnglish,
      nameArabic,
      email,
      phone,
      country,
      timezone,
      defaultCurrency,
      logoUrl,
      primaryColor,
      secondaryColor,
      cloudinaryFolder,
      subscriptionPlan,
      subscriptionStatus,
      subscriptionTrialEndsAt,
      allowedQRs,
      allowedLocations,
      serviceChargePct,
      vatPct,
      roundingRule,
      deliverectEnabled,
      posType,
      posLocationId,
      hmacSecret,
      webhookSigningSecret,
      isActive,
      isVerified,
      isSuspended,
      suspendReason,
      allowedChannels,
      tags,
      locations,
      seats,
      qrPrefixTable,
      qrPrefixRoom,
      qrStartIndexTable,
      qrStartIndexRoom,
      createdBy,
      updatedBy,
    } = req.body;

    if (!token) {
      return res.status(400).json({ message: "Firebase token required" });
    }

    // Verify Firebase token
    const decodedToken = await admin.auth().verifyIdToken(token);
    const firebaseUid = decodedToken.uid;

    // Check if already registered
    let user = await User.findOne({ firebaseUid });

    if (user) {
      return res.status(200).json({ message: "User already registered", user });
    }

    // Generate Vendor IDs
    const vendorId = uuidv4();
    const vendorCode = slugify(nameEnglish || "vendor", { lower: true, strict: true });

    // Create new user in MongoDB
    user = await User.create({
      firebaseUid,
      name: decodedToken.name || "Guest",
      email: decodedToken.email || email || "",
      role: role || "customer",
      hotelName: hotelName || null,
      designation: designation || null,

      // Vendor fields
      userId: firebaseUid,
      vendorId,
      vendorCode,
      nameEnglish,
      nameArabic,
      phone,
      country,
      timezone,
      defaultCurrency,
      logoUrl,
      primaryColor,
      secondaryColor,
      cloudinaryFolder,
      subscriptionPlan: subscriptionPlan || "FREE",
      subscriptionStatus: subscriptionStatus || "TRIAL",
      subscriptionTrialEndsAt:
        subscriptionTrialEndsAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days trial
      allowedQRs: allowedQRs || 5,
      allowedLocations: allowedLocations || 1,
      serviceChargePct: serviceChargePct || 0,
      vatPct: vatPct || 0,
      roundingRule: roundingRule || "NONE",
      deliverectEnabled: deliverectEnabled || false,
      posType: posType || "NONE",
      posLocationId: posLocationId || null,
      hmacSecret,
      webhookSigningSecret,
      isActive: isActive !== undefined ? isActive : true,
      isVerified: isVerified || false,
      isSuspended: isSuspended || false,
      suspendReason,
      allowedChannels: allowedChannels || [],
      tags: tags || [],
      locations: locations || [],
      seats: seats || [],
      qrPrefixTable: qrPrefixTable || "T",
      qrPrefixRoom: qrPrefixRoom || "R",
      qrStartIndexTable: qrStartIndexTable || 1,
      qrStartIndexRoom: qrStartIndexRoom || 1,
      createdBy: createdBy || firebaseUid,
      updatedBy: updatedBy || firebaseUid,
    });

    res.status(201).json({
      message: "User registered successfully",
      user,
    });
  } catch (error) {
    console.error("Register Error:", error);
    res.status(500).json({ message: error.message });
  }
};
