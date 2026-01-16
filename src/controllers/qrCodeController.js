// src/controllers/qrCodeController.js
import admin from "../config/firebase.js";
import QRCode from "qrcode";
import QrCode from "../models/QrCodeOrders.js";
import Branch from "../models/Branch.js";
import Vendor from "../models/Vendor.js";
import MenuItem from "../models/MenuItem.js";

import { generateQrId } from "../utils/generateQrId.js";

/** Get Bearer token from Authorization header */
function getBearerToken(req) {
  const h = req.headers?.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

/** numeric suffix helper: "table-12" -> 12  (fallback -Infinity if none) */
function suffixOf(numStr) {
  const m = /(\d+)$/.exec(String(numStr || ""));
  return m ? parseInt(m[1], 10) : -Infinity;
}
// controllers/qrCodeController.js

function normalizeBaseUrl(url) {
  let u = String(url || "").trim();
  if (!u) return "";
  u = u.replace(/\/+$/, ""); // remove trailing slashes
  return u;
}

function buildCustomerQrUrl({ baseUrl, publicSlug, typeRaw, qrId, qrNumber }) {
  const base = normalizeBaseUrl(baseUrl);
  const slug = String(publicSlug || "").trim();

  if (!base) throw new Error("PUBLIC_MENU_BASE_URL is empty");
  if (!slug) throw new Error("publicSlug is empty");

  // Keep slug clean: no leading slashes
  const cleanSlug = slug.replace(/^\/+/, "");

  // ✅ IMPORTANT: add "/" between base and slug
  return (
    `${base}/${encodeURIComponent(cleanSlug)}` +
    `?type=${encodeURIComponent(typeRaw)}` +
    `&qrId=${encodeURIComponent(qrId)}` +
    `&number=${encodeURIComponent(qrNumber)}`
  );
}

function titleCaseType(typeRaw) {
  const t = String(typeRaw || "").toLowerCase();
  if (t === "table") return "Table";
  if (t === "room") return "Room";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// controllers/qrCodeController.js
const generateQr = async (req, res) => {
  try {
    // 1) Auth
    const bearer = getBearerToken(req);
    const token = bearer || req.body?.token;
    if (!token)
      return res.status(400).json({ message: "Firebase token required" });

    const decoded = await admin.auth().verifyIdToken(token);
    const uid = decoded.uid;

    // 2) Inputs
    const branchBusinessId = String(req.body?.branchId || "").trim(); // e.g., "BR-000004"
    const typeRaw = String(req.body?.type || "").trim().toLowerCase();
    const numberOfQrsRaw = req.body?.numberOfQrs;
    // const labelRaw = req.body?.label;

    if (
      !branchBusinessId ||
      !typeRaw ||
      numberOfQrsRaw === undefined ||
      numberOfQrsRaw === null
    ) {
      return res.status(400).json({
        message: "Missing required fields (branchId, type, numberOfQrs)",
      });
    }

    if (!["table", "room"].includes(typeRaw)) {
      return res.status(400).json({ message: 'type must be "table" or "room"' });
    }

    const count = parseInt(numberOfQrsRaw, 10);
    if (!Number.isFinite(count) || count <= 0) {
      return res
        .status(400)
        .json({ message: "numberOfQrs must be a positive integer" });
    }

    // const label =
    //   typeof labelRaw === "string" && labelRaw.trim().length > 0
    //     ? labelRaw.trim()
    //     : undefined;
    const typeTitle = titleCaseType(typeRaw);


    // 3) Branch (by business id) + vendor from branch
    const branch = await Branch.findOne({ branchId: branchBusinessId }).lean();
    if (!branch) return res.status(404).json({ message: "Branch not found" });

    // ✅ IMPORTANT: we need publicSlug to generate the correct QR URL
    const publicSlug = String(branch.publicSlug || "").trim();
    if (!publicSlug) {
      return res.status(400).json({
        message:
          "publicSlug missing for this branch. Generate/assign branch publicSlug first.",
      });
    }

    // 4) Permission: vendor owner OR branch manager
    const vendor = await Vendor.findOne({ vendorId: branch.vendorId }).lean();
    const isVendorOwner = !!vendor && vendor.userId === uid;
    const isBranchManager = branch.userId === uid;

    if (!isVendorOwner && !isBranchManager) {
      return res.status(403).json({ message: "Forbidden" });
    }

    // 5) Enforce overall limit atomically
    const incField = typeRaw === "table" ? "qrGeneratedTable" : "qrGeneratedRoom";
    const filter = {
      branchId: branchBusinessId,
      $expr: { $lte: [{ $add: ["$qrGenerated", count] }, "$qrLimit"] },
    };

    const prev = await Branch.findOneAndUpdate(
      filter,
      { $inc: { qrGenerated: count, [incField]: count } },
      { new: false }
    ).lean();

    if (!prev) {
      return res.status(400).json({
        message:
          "QR limit exceeded or branch not found (concurrent request). Please try a smaller count.",
      });
    }

    // 6) Build sequential numbers per type (backfill safe)
    let prevTypeCounter = Number(prev?.[incField]);
    if (!Number.isFinite(prevTypeCounter)) {
      const lastOfType = await QrCode.find({
        branchId: { $in: [String(branch._id), branch._id] },
        vendorId: branch.vendorId,
        type: {
          $in: [typeRaw, typeRaw.charAt(0).toUpperCase() + typeRaw.slice(1)],
        }, // legacy mix
      })
        .select("number")
        .sort({ createdAt: -1, _id: -1 })
        .limit(1)
        .lean();

      const maxSuffix = suffixOf(lastOfType?.[0]?.number);
      prevTypeCounter = Number.isFinite(maxSuffix) ? Math.max(0, maxSuffix) : 0;
    }
    const startIndex = prevTypeCounter + 1;

    // ✅ Base URL for customer menu (set in env, fallback to your production domain)
    // Use ONE env name consistently. Keep your existing name if you already set it.
    const PUBLIC_MENU_BASE_URL =
      process.env.PUBLIC_MENU_BASE_URL || "https://menu.vuedine.com";

    // 7) Create docs
    const created = [];
for (let i = 0; i < count; i++) {
  const suffix = startIndex + i;
  const qrId = await generateQrId();
  const qrNumber = `${typeRaw}-${suffix}`;

  // ✅ AUTO LABEL from sequence
  const label = `${typeTitle} ${suffix}`;

  const customerUrl = buildCustomerQrUrl({
    baseUrl: PUBLIC_MENU_BASE_URL,
    publicSlug,
    typeRaw,
    qrId,
    qrNumber,
  });

  const qrImage = await QRCode.toDataURL(customerUrl);

  const doc = await QrCode.create({
    qrId,
    branchId: String(branch._id),
    vendorId: branch.vendorId,
    type: typeRaw,     // ✅ REQUIRED
    label: label,      // ✅ REQUIRED
    number: qrNumber,
    qrUrl: qrImage,
    active: true,
  });

  created.push({
    qrId: doc.qrId,
    branchId: doc.branchId,
    vendorId: doc.vendorId,
    type: doc.type,
    label: doc.label,
    number: doc.number,
    qrUrl: doc.qrUrl,
    active: doc.active,
    _id: doc._id,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    __v: doc.__v,
    encodedUrl: customerUrl,
  });
}
    return res.status(201).json({
      message: "QR codes generated successfully",
      generated: created.length,
      startFrom: startIndex,
      qrs: created,
    });
  } catch (error) {
    console.error("QR Generate Error:", error);
    return res.status(500).json({ message: error.message });
  }
};

export default generateQr;

/**
 * GET /api/qrcode/branch/:branchId
 * - :branchId is the Mongo ObjectId string (e.g., "68e40176727a4e93b229efab")
 * - Auth: Authorization: Bearer <token>
 * - Returns QRs in ASCENDING order by type then numeric suffix (table-1, table-2, …).
 */
// controllers/qrCodeController.js
// controllers/qrCodeController.js
export const getBranchQrs = async (req, res) => {
  try {
    const h = req.headers?.authorization || "";
    const tokenMatch = /^Bearer\s+(.+)$/i.exec(h);
    const token = tokenMatch ? tokenMatch[1] : null;

    if (!token) return res.status(400).json({ message: "Firebase token required" });

    const decoded = await admin.auth().verifyIdToken(token);
    const uid = decoded.uid;

    const branchObjectId = String(req.params?.branchId || "").trim();
    if (!branchObjectId) return res.status(400).json({ message: "branchId (Mongo _id) is required" });

    console.log("[QR][GET] uid =", uid);
    console.log("[QR][GET] branchObjectId =", branchObjectId);

    const branch = await Branch.findById(branchObjectId).lean();
    if (!branch) {
      console.log("[QR][GET] branch not found");
      return res.status(404).json({ message: "Branch not found" });
    }

    // Load vendor by the branch's vendorId (not by user uid)
    const vendor = await Vendor.findOne({ vendorId: branch.vendorId }).lean();

    const isVendorOwner   = !!vendor && vendor.userId === uid;
    const isBranchManager = branch.userId === uid;

    console.log("[QR][GET] vendorId on branch =", branch.vendorId);
    console.log("[QR][GET] vendor owner uid =", vendor?.userId);
    console.log("[QR][GET] branch manager uid =", branch.userId);
    console.log("[QR][GET] isVendorOwner =", isVendorOwner, "isBranchManager =", isBranchManager);

    if (!isVendorOwner && !isBranchManager) {
      console.log("[QR][GET] Forbidden for this uid");
      return res.status(403).json({ message: "Forbidden" });
    }

    // Fetch QRs that match this branch and vendor (works for both roles)
    const items = await QrCode.find({
      $and: [
        { $or: [{ branchId: branchObjectId }, { branchId: branch._id }] },
        { vendorId: branch.vendorId },
      ],
    }).lean();

    // Sort asc by type then numeric suffix (table-1, table-2, …)
    // const suffixOf = (numStr) => {
    //   const m = /(\d+)$/.exec(String(numStr || ""));
    //   return m ? parseInt(m[1], 10) : -Infinity;
    // };

    items.sort((a, b) => {
      const tA = String(a.type || "");
      const tB = String(b.type || "");
      if (tA !== tB) return tA.localeCompare(tB);
      const nA = suffixOf(a.number);
      const nB = suffixOf(b.number);
      if (nA !== nB) return nA - nB;
      return String(a._id).localeCompare(String(b._id));
    });

    console.log("[QR][GET] total items =", items.length);

    return res.status(200).json({
      branchObjectId,
      branchId: branch.branchId,   // business id (BR-000004)
      vendorId: branch.vendorId,
      total: items.length,
      items,
    });
  } catch (err) {
    console.error("QR List Error:", err);
    return res.status(500).json({ message: err.message });
  }
};



/**
 * POST /api/qrcode/branch/:branchId/delete-latest
 * Body: { type: "table"|"room", count: 3 }
 * - Deletes from the **top** (highest suffix first) within the chosen type only.
 * - Decrements BOTH total (qrGenerated) and the per-type counter.
 */

export const deleteLatestQrs = async (req, res) => {
  try {
    const token = getBearerToken(req);
    if (!token) return res.status(400).json({ message: "Firebase token required" });

    const decoded = await admin.auth().verifyIdToken(token);
    const uid = decoded.uid;

    const branchObjectId = String(req.params?.branchId || "").trim();
    const rawType = String(req.body?.type || "").trim().toLowerCase();
    const rawCount = req.body?.count;

    if (!branchObjectId) return res.status(400).json({ message: "branchId (Mongo _id) is required" });
    if (!["table", "room"].includes(rawType)) {
      return res.status(400).json({ message: 'type must be "table" or "room"' });
    }
    const count = parseInt(rawCount, 10);
    if (!Number.isFinite(count) || count <= 0) {
      return res.status(400).json({ message: "count must be a positive integer" });
    }

    const branch = await Branch.findById(branchObjectId).lean();
    if (!branch) return res.status(404).json({ message: "Branch not found" });

    const vendor = await Vendor.findOne({ vendorId: branch.vendorId }).lean();
    const isVendorOwner = !!vendor && vendor.userId === uid;
    const isBranchManager = branch.userId === uid;
    if (!isVendorOwner && !isBranchManager) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const typeCandidates = [rawType, rawType.charAt(0).toUpperCase() + rawType.slice(1)]; // legacy

    const candidates = await QrCode.find({
      $and: [
        { $or: [{ branchId: branchObjectId }, { branchId: branch._id }] },
        { vendorId: branch.vendorId },
        { type: { $in: typeCandidates } },
      ],
    }).select("_id number type").lean();

    if (!candidates.length) {
      return res.status(200).json({
        message: `No QRs found for type "${rawType}" on this branch.`,
        deleted: 0,
        deletedNumbers: [],
        newQrGenerated: branch.qrGenerated ?? 0,
      });
    }

    candidates.sort((a, b) => suffixOf(b.number) - suffixOf(a.number));
    const toDelete = candidates.slice(0, Math.min(count, candidates.length));
    const ids = toDelete.map(d => d._id);
    const deletedNumbers = toDelete.map(d => String(d.number || ""));

    const delRes = await QrCode.deleteMany({ _id: { $in: ids } });
    const actuallyDeleted = delRes?.deletedCount || 0;

    const incField = rawType === "table" ? "qrGeneratedTable" : "qrGeneratedRoom";
    if (actuallyDeleted > 0) {
      const fresh = await Branch.findById(branch._id, "qrGenerated qrGeneratedTable qrGeneratedRoom").lean();
      const currentTotal = Number(fresh?.qrGenerated ?? 0);
      const currentType  = Number(fresh?.[incField] ?? 0);
      const nextTotal = Math.max(0, currentTotal - actuallyDeleted);
      const nextType  = Math.max(0, currentType - actuallyDeleted);
      await Branch.findByIdAndUpdate(branch._id, { $set: { qrGenerated: nextTotal, [incField]: nextType } });
    }

    const after = await Branch.findById(branch._id, "qrGenerated").lean();

    return res.status(200).json({
      message: `Deleted ${actuallyDeleted} ${rawType} QR(s) from the top.`,
      type: rawType,
      deleted: actuallyDeleted,
      deletedNumbers,
      newQrGenerated: Number(after?.qrGenerated ?? 0),
    });
  } catch (err) {
    console.error("QR Delete Error:", err);
    return res.status(500).json({ message: err.message });
  }
};

function isObjectId(id) {
  return mongoose.Types.ObjectId.isValid(String(id || ""));
}

// function suffixOf(numStr) {
//   const m = /(\d+)$/.exec(String(numStr || ""));
//   return m ? parseInt(m[1], 10) : null;
// }

function parseSeatFromQr({ type, number }) {
  const kind = String(type || "").toLowerCase(); // "table" | "room"
  const idx = suffixOf(number);
  return {
    kind: ["table", "room"].includes(kind) ? kind : undefined,
    index: Number.isFinite(idx) ? idx : undefined,
  };
}

// Build extra metadata (same behavior as your public controller)
async function buildMetaForBranch(branch) {
  const currency = branch?.currency ?? null;

  let vendor = { vendorId: null, vatNumber: null, vatRate: null };
  let settings = undefined;

  if (branch?.vendorId) {
    const v = await Vendor.findOne({ vendorId: branch.vendorId })
      .select("vendorId billing.vatNumber taxes.vatPercentage settings.priceIncludesVat")
      .lean();

    if (v) {
      const vatPct =
        typeof v?.taxes?.vatPercentage === "number" ? v.taxes.vatPercentage : null;

      vendor = {
        vendorId: v.vendorId || null,
        vatNumber: v?.billing?.vatNumber ?? null,
        vatRate: vatPct !== null ? vatPct / 100 : null, // 10 -> 0.10
        
      };

      if (typeof v?.settings?.priceIncludesVat === "boolean") {
        settings = { priceIncludesVat: v.settings.priceIncludesVat };
      }
    }
  }

  return { currency, vendor, settings };
}

async function resolveQrContext(req) {
  const qrId = String(req.query?.qrId || req.query?.qr || "").trim();
  const branchBizId = String(req.query?.branch || "").trim(); // optional
  const type = String(req.query?.type || "").trim().toLowerCase();
  const number = String(req.query?.number || "").trim();

  if (!qrId) {
    const err = new Error("qrId is required");
    err.status = 400;
    throw err;
  }

  if (!type || !number) {
    const err = new Error("type and number are required");
    err.status = 400;
    throw err;
  }

  const qr = await QrCode.findOne({ qrId }).lean();
  if (!qr) {
    const err = new Error("QR not found");
    err.status = 404;
    throw err;
  }

  if (qr.active === false) {
    const err = new Error("QR is inactive");
    err.status = 410;
    throw err;
  }

  // type/number integrity checks (VERY IMPORTANT)
  if (String(qr.type || "").toLowerCase() !== type) {
    const err = new Error("type mismatch for QR");
    err.status = 409;
    throw err;
  }

  if (String(qr.number || "") !== number) {
    const err = new Error("number mismatch for QR");
    err.status = 409;
    throw err;
  }
  // Load branch via QR's stored branchId (Mongo _id string)
  let branch = null;
  if (isObjectId(qr.branchId)) {
    branch = await Branch.findById(qr.branchId).lean();
  }
  if (!branch && branchBizId) {
    branch = await Branch.findOne({ branchId: branchBizId }).lean();
  }
  if (!branch) {
    const err = new Error("Branch not found for QR");
    err.status = 404;
    throw err;
  }

  // Integrity checks
  if (branchBizId && branch.branchId !== branchBizId) {
    const err = new Error("branch mismatch between QR and request");
    err.status = 409;
    throw err;
  }
  if (qr.vendorId && branch.vendorId && qr.vendorId !== branch.vendorId) {
    const err = new Error("vendor mismatch between QR and branch");
    err.status = 409;
    throw err;
  }
  if (type && String(qr.type || "").toLowerCase() !== type) {
    const err = new Error("type mismatch for QR");
    err.status = 409;
    throw err;
  }
  if (number && String(qr.number || "") !== number) {
    const err = new Error("number mismatch for QR");
    err.status = 409;
    throw err;
  }

  const seat = parseSeatFromQr({ type: qr.type, number: qr.number });
  const qrPublic = {
    qrId: qr.qrId,
    type: qr.type,           // "table" | "room"
    number: qr.number,       // e.g., "table-12"
    label: qr.label ?? undefined,
    active: qr.active !== false,
    vendorId: qr.vendorId ?? undefined,
    branchObjectId: String(qr.branchId || ""),
    branchId: branch.branchId, // business id (BR-xxxxx)
    seat, // { kind, index }
  };

  return { qr: qrPublic, branch };
}

// -------------------------------------------------------------
// GET /api/qr/menu/sections?qrId=...&branch=BR-000005
export const getQrMenuSections = async (req, res) => {
  try {
    const { qr, branch } = await resolveQrContext(req);

    const sections = (branch.menuSections || [])
      .filter((s) => s.isEnabled === true)
      .map((s) => ({
        key: s.key,
        nameEnglish: s.nameEnglish,
        nameArabic: s.nameArabic,
        itemCount: s.itemCount ?? undefined,
        icon: s.icon ?? undefined,
      }));

    const meta = await buildMetaForBranch(branch);
    const taxes = {
      vatPercentage: Number(branch?.taxes?.vatPercentage ?? 0) || 0,
      serviceChargePercentage:
        Number(branch?.taxes?.serviceChargePercentage ?? 0) || 0,
      vatNumber: (branch?.taxes?.vatNumber ?? "").toString(),
      // default TRUE if not set (as you wanted on registration)
      isVatInclusive: branch?.taxes?.isVatInclusive !== false,
    };
    return res.json({
      branchId: branch.branchId,
      taxes,
      sections,
      ...meta,
      qr,
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ message: err.message || "Failed to load sections" });
  }
};

// -------------------------------------------------------------
// GET /api/qr/menu/items?qrId=...&sectionKey=...&page=&limit=
export const getQrSectionItems = async (req, res) => {
  try {
    const sectionKey = String(req.query?.sectionKey || "").trim();
    if (!sectionKey) {
      return res.status(400).json({ message: "sectionKey is required" });
    }

    const page = Math.max(1, parseInt(String(req.query?.page || "1"), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query?.limit || "20"), 10)));
    const skip = (page - 1) * limit;

    const { qr, branch } = await resolveQrContext(req);

    const query = {
      branchId: branch.branchId, // business id
      sectionKey,
      isActive: true,
      isAvailable: true,
    };

    const total = await MenuItem.countDocuments(query);
    const items = await MenuItem.find(query)
      .sort({ sortOrder: 1, nameEnglish: 1 })
      .skip(skip)
      .limit(limit)
      .select(
        "_id branchId vendorId sectionKey sortOrder itemType " +
        "nameEnglish nameArabic description descriptionArabic imageUrl videoUrl " +
        "allergens tags isFeatured isActive isAvailable isSpicy " +
        "calories sku preparationTimeInMinutes ingredients addons " +
        "isSizedBased sizes fixedPrice offeredPrice discount createdAt updatedAt"
      )
      .lean();

    const meta = await buildMetaForBranch(branch);

    return res.json({
      branchId: branch.branchId,
      sectionKey,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      ...meta,
      qr,
      items,
    });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ message: err.message || "Failed to load items" });
  }
};

// -------------------------------------------------------------
// GET /api/qr/menu/section-grouped?qrId=...&sectionKey=...&limit=
export const getQrSectionItemsGrouped = async (req, res) => {
  try {
    const sectionKey = String(req.query?.sectionKey || "").trim();
    if (!sectionKey) {
      return res.status(400).json({ message: "sectionKey is required" });
    }

    const hardCap = Math.min(1000, Math.max(1, parseInt(String(req.query?.limit || "1000"), 10)));

    const { qr, branch } = await resolveQrContext(req);

    const query = {
      branchId: branch.branchId,
      sectionKey,
      isActive: true,
      isAvailable: true,
    };

    const items = await MenuItem.find(query)
      .sort({ sortOrder: 1, nameEnglish: 1 })
      .limit(hardCap)
      .lean();

    // Group by itemType (fallback to "UNCATEGORIZED")
    const map = new Map();
    for (const it of items) {
      const key = (it.itemType && String(it.itemType).trim()) || "UNCATEGORIZED";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(it);
    }

    const groups = Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([itemType, list]) => ({
        itemType,
        count: list.length,
        items: list,
      }));

    const meta = await buildMetaForBranch(branch);

    return res.json({
      branchId: branch.branchId,
      sectionKey,
      totalItems: items.length,
      ...meta,
      qr,
      groups,
    });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ message: err.message || "Failed to load grouped items" });
  }
};

// -------------------------------------------------------------
// GET /api/qr/menu/catalog?qrId=...&maxPerSection=
export const getQrBranchCatalog = async (req, res) => {
  try {
    const maxPerSection = Math.min(
      2000,
      Math.max(1, parseInt(String(req.query?.maxPerSection || "1000"), 10))
    );

    const { qr, branch } = await resolveQrContext(req);

    const enabledSections = (branch.menuSections || []).filter((s) => s.isEnabled === true);

    const sections = await Promise.all(
      enabledSections.map(async (s) => {
        const items = await MenuItem.find({
          branchId: branch.branchId,
          sectionKey: s.key,
          isActive: true,
          isAvailable: true,
        })
          .sort({ sortOrder: 1, nameEnglish: 1 })
          .limit(maxPerSection)
          .lean();

        // Group by itemType
        const gmap = new Map();
        for (const it of items) {
          const key = (it.itemType && String(it.itemType).trim()) || "UNCATEGORIZED";
          if (!gmap.has(key)) gmap.set(key, []);
          gmap.get(key).push(it);
        }

        const itemTypes = Array.from(gmap.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([itemType, list]) => ({
            itemType,
            count: list.length,
            items: list,
          }));

        return {
          key: s.key,
          nameEnglish: s.nameEnglish,
          nameArabic: s.nameArabic,
          itemCount: s.itemCount ?? undefined,
          itemTypes,
        };
      })
    );

    const meta = await buildMetaForBranch(branch);

    return res.json({
      branch: {
        branchId: branch.branchId,
        nameEnglish: branch.nameEnglish,
        nameArabic: branch.nameArabic,
        currency: branch.currency ?? undefined,
        taxes: branch.taxes ?? undefined,
        branding: branch.branding ?? undefined,
      },
      ...meta,
      qr,
      sections,
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ message: err.message || "Failed to load catalog" });
  }
};

