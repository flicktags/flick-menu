// src/controllers/publicMenuController.js
import Branch from "../models/Branch.js";
import QrCode from "../models/QrCodeOrders.js";

/**
 * GET /api/public/menu
 * Query:
 *   - branch=BR-000004           (business code)
 *   - or qrId=QR-000120          (we resolve branch via QR)
 *
 * Returns a SAMPLE menu payload so you can test the client UI & order payload.
 * Later, swap the sample `items` with your real DB items.
 */
export const getPublicMenu = async (req, res) => {
  try {
    const { branch: branchBusinessId, qrId } = req.query || {};

    console.log("[PUBLIC MENU] query:", req.query);

    // 1) Resolve branch
    let branch;
    if (branchBusinessId) {
      branch = await Branch.findOne({ branchId: branchBusinessId }).lean();
    } else if (qrId) {
      // resolve via QR
      const qr = await QrCode.findOne({ qrId }).lean();
      if (qr) {
        branch = await Branch.findById(qr.branchId).lean();
      }
    }
    if (!branch) {
      return res.status(404).json({ message: "Branch not found" });
    }

    // 2) Basic branch info
    const branchInfo = {
      branchId: branch.branchId,
      nameEnglish: branch.nameEnglish,
      nameArabic: branch.nameArabic || null,
      currency: branch.currency || "BHD",
      taxes: {
        vatPercentage: (branch.taxes?.vatPercentage ?? 0),
        serviceChargePercentage: (branch.taxes?.serviceChargePercentage ?? 0),
      },
    };

    // 3) Sections (use your branch.menuSections or a default)
    const sections =
      Array.isArray(branch.menuSections) && branch.menuSections.length
        ? branch.menuSections.map(s => ({
            key: String(s.key || ""),
            nameEnglish: String(s.nameEnglish || s.key || ""),
            nameArabic: s.nameArabic || null,
            sortOrder: Number(s.sortOrder ?? 0),
          }))
        : [
            { key: "BURGERS", nameEnglish: "Burgers", nameArabic: "برجر", sortOrder: 0 },
            { key: "PIZZA",   nameEnglish: "Pizza",   nameArabic: "بيتزا", sortOrder: 1 },
          ];

    // 4) SAMPLE items (⛳️ Replace later with your real DB items)
    const items = [
      {
        itemId: "burger-big",
        sectionKey: sections[0]?.key ?? "BURGERS",
        nameEnglish: "Big Burger",
        nameArabic: "برجر كبير",
        description: "Grilled beef patty with lettuce and tomato.",
        image: null,
        available: true,

        // Base price (no size). We’ll allow an offer later.
        basePrice: 2.5,

        // No variants for burger (null or empty)
        variants: [],

        // Add-on groups
        addonGroups: [
          {
            id: "grp-spice",
            nameEnglish: "Spice Level",
            nameArabic: "درجة الحارة",
            selection: "single", // single | multi
            addons: [
              { id: "spice-normal",  nameEnglish: "Normal",       price: 0.0 },
              { id: "spice-extra",   nameEnglish: "Extra Spicy",  price: 0.0 }
            ]
          },
          {
            id: "grp-extras",
            nameEnglish: "Extras",
            nameArabic: "إضافات",
            selection: "multi", // multi
            addons: [
              { id: "cheese-extra",  nameEnglish: "Extra Cheese", price: 0.2 },
              { id: "mayo-extra",    nameEnglish: "Extra Mayo",   price: 0.1 }
            ]
          }
        ],
      },

      {
        itemId: "pizza-margherita",
        sectionKey: sections[1]?.key ?? "PIZZA",
        nameEnglish: "Pizza Margherita",
        nameArabic: "بيتزا مارجريتا",
        description: "Classic tomato, mozzarella, and basil.",
        image: null,
        available: true,

        // Pizza uses variants
        basePrice: null,
        variants: [
          { id: "size-small",  name: "Small",  price: 1.0 },
          { id: "size-medium", name: "Medium", price: 1.5 },
          { id: "size-large",  name: "Large",  price: 2.0 },
        ],

        addonGroups: [
          {
            id: "grp-cheese",
            nameEnglish: "Cheese",
            nameArabic: "جبن",
            selection: "multi",
            addons: [
              { id: "mozzarella-extra", nameEnglish: "Extra Mozzarella", price: 0.3 }
            ]
          }
        ],
      },
    ];

    // (Optional) sort sections
    sections.sort((a, b) => a.sortOrder - b.sortOrder);

    const payload = {
      branch: branchInfo,
      sections,
      items,
      serverTime: new Date().toISOString(),
    };

    console.log("[PUBLIC MENU] OK -> sections:", sections.length, "items:", items.length);
    return res.status(200).json(payload);
  } catch (err) {
    console.error("[PUBLIC MENU] Error:", err);
    return res.status(500).json({ message: err.message });
  }
};
