// src/controllers/publicMenuController.js
import Branch from "../models/Branch.js";
// ⬇️ Change this import to your real menu item model file if named differently
import MenuItem from "../models/MenuItem.js";

/**
 * GET /api/public/menu
 * Query: branch=BR-000004&type=room|table&number=room-1&qrId=QR-000131
 * Returns branch info (+ menuSections) publicly (no auth).
 */
export const getPublicMenu = async (req, res) => {
  try {
    const branchId = String(req.query?.branch || "").trim();
    if (!branchId) {
      return res.status(400).json({ message: "branch is required (business id)" });
    }

    const branch = await Branch.findOne({ branchId })
      .select(
        "branchId nameEnglish nameArabic currency taxes branding menuSections"
      )
      .lean();

    if (!branch) {
      return res.status(404).json({ message: "Branch not found" });
    }

    return res.status(200).json({
      branch,
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    console.error("PublicMenu Error:", err);
    return res.status(500).json({ message: err.message });
  }
};

/**
 * GET /api/public/menu/items
 * Query: branch=BR-000004&sectionKey=DINNER&page=1&limit=20
 * Public items (only active & available).
 */
export const getPublicSectionItems = async (req, res) => {
  try {
    const branchId = String(req.query?.branch || "").trim();
    const sectionKey = String(req.query?.sectionKey || "").trim();
    const page = Math.max(1, parseInt(String(req.query?.page || "1"), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query?.limit || "20"), 10)));
    const skip = (page - 1) * limit;

    if (!branchId || !sectionKey) {
      return res.status(400).json({ message: "branch and sectionKey are required" });
    }

    // Make sure the branch exists (by business id)
    const branch = await Branch.findOne({ branchId }).select("branchId").lean();
    if (!branch) {
      return res.status(404).json({ message: "Branch not found" });
    }

    const query = {
      branchId,                // business id stored on your items
      sectionKey,
      isActive: true,
      isAvailable: true,
    };

    const total = await MenuItem.countDocuments(query);
    const items = await MenuItem.find(query)
      .sort({ sortOrder: 1, nameEnglish: 1 }) // tweak as you like
      .skip(skip)
      .limit(limit)
      .select(
        "_id branchId vendorId sectionKey sortOrder itemType " +
          "nameEnglish nameArabic description imageUrl videoUrl " +
          "allergens tags isFeatured isActive isAvailable isSpicy " +
          "calories sku preparationTimeInMinutes ingredients addons " +
          "isSizedBased sizes fixedPrice offeredPrice discount createdAt updatedAt"
      )
      .lean();

    return res.status(200).json({
      branchId,
      sectionKey,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      items,
    });
  } catch (err) {
    console.error("PublicSectionItems Error:", err);
    return res.status(500).json({ message: err.message });
  }
};
