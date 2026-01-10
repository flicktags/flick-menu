// controllers/dashboardController.js
import Branch from "../models/Branch.js";
import Vendor from "../models/Vendor.js";
import MenuItem from "../models/MenuItem.js";
// If you have MenuType model and want counts from it, import it too:
// import MenuType from "../models/MenuType.js";

// ---------------- same ownership helper ----------------
async function userOwnsBranch(req, branch) {
  const uid = req.user?.uid;
  if (!uid || !branch) return false;

  if (branch.userId === uid) return true;

  const vendor = await Vendor.findOne({ vendorId: branch.vendorId }).lean();
  if (vendor && vendor.userId === uid) return true;

  return false;
}

// ---------------- GET /api/dashboard/summary?branchId=BR-000009 ----------------
export const getDashboardSummary = async (req, res) => {
  try {
    const branchId = String(req.query.branchId || "").trim();
    if (!branchId) {
      return res
        .status(400)
        .json({ code: "BRANCH_ID_REQUIRED", message: "branchId is required" });
    }

    const branch = await Branch.findOne({ branchId }).lean(false);
    if (!branch) {
      return res
        .status(404)
        .json({ code: "BRANCH_NOT_FOUND", message: "Branch not found" });
    }

    if (!(await userOwnsBranch(req, branch))) {
      return res
        .status(403)
        .json({ code: "FORBIDDEN", message: "You do not own this branch" });
    }

    // ----- Menu sections enabled on branch -----
    const enabledSections = (branch.menuSections || []).filter(
      (s) => s && s.isEnabled === true
    );

    const totalSections = (branch.menuSections || []).length;
    const enabledSectionsCount = enabledSections.length;

    // If you treat "menuTypes enabled" == enabled sections (your current model),
    // then this is the same value:
    const enabledMenuTypesCount = enabledSectionsCount;

    // ----- Items counts -----
    const filter = { branchId };

    const [
      totalItems,
      activeItems,
      availableItems,
      featuredItems,
      itemsWithImages,
      itemsWithVideos,
    ] = await Promise.all([
      MenuItem.countDocuments(filter),
      MenuItem.countDocuments({ ...filter, isActive: true }),
      MenuItem.countDocuments({ ...filter, isAvailable: true }),
      MenuItem.countDocuments({ ...filter, isFeatured: true }),
      MenuItem.countDocuments({
        ...filter,
        imageUrl: { $exists: true, $ne: "" },
      }),
      MenuItem.countDocuments({
        ...filter,
        videoUrl: { $exists: true, $ne: "" },
      }),
    ]);

    // OPTIONAL: if your Branch schema stores a "menu stamp" / last change time
    // (you call touchBranchMenuStampByBizId(branchId)), you may already have a field like:
    // branch.menuStampAt, branch.menuUpdatedAt, branch.menuStamp, etc.
    // Just return it if it exists:
    const lastMenuUpdate =
      branch.menuStampAt ||
      branch.menuUpdatedAt ||
      branch.updatedAt ||
      null;

    return res.json({
      message: "Dashboard summary",
      branchId,
      vendorId: branch.vendorId,

      menu: {
        totalSections,
        enabledSectionsCount,
        enabledMenuTypesCount,
        enabledSectionKeys: enabledSections.map((s) => s.key),
      },

      items: {
        totalItems,
        activeItems,
        availableItems,
        featuredItems,
        itemsWithImages,
        itemsWithVideos,
      },

      lastMenuUpdate,
    });
  } catch (err) {
    console.error("getDashboardSummary error:", err);
    return res.status(500).json({
      code: "SERVER_ERROR",
      message: err?.message || "Unexpected error",
    });
  }
};
