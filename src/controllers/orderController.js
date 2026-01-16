// // src/controllers/orderController.js
// import Branch from "../models/Branch.js";
// import MenuItem from "../models/MenuItem.js";
// import Order from "../models/Order.js";
// import Counter, { nextSeq } from "../models/Counter.js";

// // ---- helpers ----
// function decimalsForCurrency(cur) {
//   if (!cur) return 2;
//   const c = String(cur).toUpperCase();
//   return c === "BHD" ? 3 : 2;
// }
// function roundMoney(n, dp) {
//   const p = Math.pow(10, dp);
//   return Math.round((Number(n) + Number.EPSILON) * p) / p;
// }
// function onlyDigits(s) {
//   return String(s || "").replace(/\D+/g, "");
// }
// function lastN(str, n) {
//   const d = onlyDigits(str);
//   if (d.length >= n) return d.slice(-n);
//   return d.padStart(n, "0");
// }
// function ymdInTZ(tz) {
//   // Use Intl.DateTimeFormat to get parts in the branch timezone (fallback UTC)
//   const fmt = new Intl.DateTimeFormat("en-GB", {
//     timeZone: tz || "UTC",
//     year: "numeric",
//     month: "2-digit",
//     day: "2-digit",
//   });
//   const parts = fmt.formatToParts(new Date());
//   const y = parts.find((p) => p.type === "year")?.value || "0000";
//   const m = parts.find((p) => p.type === "month")?.value || "00";
//   const d = parts.find((p) => p.type === "day")?.value || "00";
//   return { y, m, d };
// }

// /**
//  * Normalize/resolve a single request line item with DB values.
//  */
// async function resolveLineItem(reqLine, branchId, currency, dp) {
//   try {
//     const qty = Math.max(1, parseInt(reqLine?.quantity ?? 1, 10));

//     const dbItem = await MenuItem.findOne({
//       _id: reqLine?.itemId,
//       branchId: branchId,
//       isActive: true,
//       isAvailable: true,
//     }).lean();

//     const nameEnglish = dbItem?.nameEnglish ?? String(reqLine?.nameEnglish ?? "");
//     const nameArabic  = dbItem?.nameArabic ?? String(reqLine?.nameArabic ?? "");
//     const imageUrl    = dbItem?.imageUrl ?? String(reqLine?.imageUrl ?? "");

//     const isSizedBased = Boolean(dbItem?.isSizedBased ?? reqLine?.isSizedBased);

//     let size = null;
//     let unitBasePrice = 0;

//     if (isSizedBased) {
//       const reqLabel = String(reqLine?.size?.label ?? "").trim();
//       const dbSizes = Array.isArray(dbItem?.sizes) ? dbItem.sizes : [];
//       const hit = dbSizes.find(
//         (s) => String(s?.label ?? "").trim().toLowerCase() === reqLabel.toLowerCase()
//       );
//       if (!hit) {
//         if (dbSizes.length > 0) {
//           size = { label: String(dbSizes[0].label ?? ""), price: Number(dbSizes[0].price ?? 0) };
//         } else {
//           size = { label: reqLabel || "Default", price: 0 };
//         }
//       } else {
//         size = { label: String(hit.label ?? ""), price: Number(hit.price ?? 0) };
//       }
//       unitBasePrice = Number(size.price || 0);
//     } else {
//       const base =
//         dbItem?.offeredPrice ??
//         dbItem?.fixedPrice ??
//         reqLine?.offeredPrice ??
//         reqLine?.fixedPrice ??
//         0;
//       unitBasePrice = Number(base || 0);
//     }

//     const reqAddons = Array.isArray(reqLine?.addons) ? reqLine.addons : [];
//     const normalizedAddons = reqAddons.map((a) => ({
//       id: (a?._id ?? a?.id ?? a?.label ?? "").toString(),
//       label: (a?.label ?? a?.nameEnglish ?? a?.nameArabic ?? "").toString(),
//       price: Number(a?.price ?? 0),
//     }));
//     const addonsSum = normalizedAddons.reduce((acc, a) => acc + Number(a.price || 0), 0);
//     const unitTotal = unitBasePrice + addonsSum;
//     const lineTotal = roundMoney(unitTotal * qty, dp);

//     return {
//       ok: true,
//       normalizedLine: {
//         itemId: dbItem?._id?.toString() ?? String(reqLine?.itemId ?? ""),
//         nameEnglish,
//         nameArabic,
//         imageUrl,
//         isSizedBased,
//         size, // null if not sized
//         addons: normalizedAddons,
//         unitBasePrice: roundMoney(unitBasePrice, dp),
//         quantity: qty,
//         notes: String(reqLine?.notes ?? ""),
//         lineTotal,
//       },
//     };
//   } catch (err) {
//     return { ok: false, err };
//   }
// }

// /**
//  * POST /api/public/orders
//  */
// export const createOrder = async (req, res) => {
//   try {
//     const branchId = String(req.body?.branch || req.body?.branchId || "").trim();
//     if (!branchId) {
//       return res.status(400).json({ error: 'Missing "branch" (e.g., "BR-000004")' });
//     }

//     const branch = await Branch.findOne({ branchId }).lean();
//     if (!branch) return res.status(404).json({ error: "Branch not found" });

//     const currency = String(req.body?.currency || branch.currency || "").trim().toUpperCase();
//     const dp = decimalsForCurrency(currency);

//     const vatPercent = Number(branch?.taxes?.vatPercentage ?? 0);
//     const serviceChargePercent = Number(branch?.taxes?.serviceChargePercentage ?? 0);

//     const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
//     if (rawItems.length === 0) {
//       return res.status(400).json({ error: "No items provided" });
//     }

//     const resolved = [];
//     for (const line of rawItems) {
//       const r = await resolveLineItem(line, branchId, currency, dp);
//       if (!r.ok) {
//         return res.status(400).json({
//           error: "Unable to resolve item",
//           itemId: line?.itemId ?? null,
//           details: String(r.err?.message || r.err),
//         });
//       }
//       resolved.push(r.normalizedLine);
//     }

//     const subtotal = roundMoney(
//       resolved.reduce((acc, l) => acc + Number(l.lineTotal || 0), 0),
//       dp
//     );
//     const serviceChargeAmount = roundMoney((subtotal * serviceChargePercent) / 100, dp);
//     const vatBase = subtotal + serviceChargeAmount;
//     const vatAmount = roundMoney((vatBase * vatPercent) / 100, dp);
//     const grandTotal = roundMoney(subtotal + serviceChargeAmount + vatAmount, dp);

//     // ---- ORDER NUMBER (YYYYMMDD + vendor2 + branch5 + counter7) ----
//     const { y, m, d } = ymdInTZ(branch?.timeZone); // branch-local date
//     const vendor2  = lastN(branch?.vendorId, 2);    // e.g. V000023 -> "23"
//     const branch5  = lastN(branchId, 5);            // e.g. BR-000004 -> "00004"

//     // Per-branch counter key remains stable for sequencing
//     const counterKey = `ORD-${branchId}`;
//     const seq = await nextSeq(counterKey);          // 1, 2, 3, ...
//     const counter7 = String(seq).padStart(7, "0");

//     const orderNumber = `${y}${m}${d}${vendor2}${branch5}${counter7}`;

//     const qr = req.body?.qr && typeof req.body.qr === "object" ? req.body.qr : null;
//     const customer = req.body?.customer && typeof req.body.customer === "object"
//       ? req.body.customer
//       : null;

//     const payload = {
//       orderNumber,                 // e.g., 2025101823000040000001
//       branchId,
//       currency,
//       qr: qr
//         ? {
//             type: String(qr.type ?? ""),
//             number: String(qr.number ?? ""),
//             qrId: String(qr.qrId ?? ""),
//           }
//         : null,
//       customer: {
//         name: String(customer?.name ?? ""),
//         phone: customer?.phone ? String(customer.phone) : null,
//       },
//       items: resolved,
//       pricing: {
//         subtotal,
//         serviceChargePercent,
//         serviceChargeAmount,
//         vatPercent,
//         vatAmount,
//         grandTotal,
//       },
//       remarks: req.body?.remarks ? String(req.body.remarks) : null,
//       source: String(req.body?.source ?? "customer_view"),
//       status: "PENDING",
//       placedAt: new Date(),
//     };

//     const doc = await Order.create(payload);

//     return res.status(201).json({
//       message: "Order placed",
//       orderId: doc._id,
//       orderNumber: doc.orderNumber, // now YYYYMMDD + vendor2 + branch5 + counter7
//       branchId: doc.branchId,
//       currency: doc.currency,
//       status: doc.status,
//       pricing: doc.pricing,
//       items: doc.items,
//       customer: doc.customer,
//       qr: doc.qr,
//       placedAt: doc.placedAt,
//     });
//   } catch (err) {
//     console.error("[ORDER][CREATE][ERROR]", err);
//     return res.status(500).json({ error: err.message || "Internal Server Error" });
//   }
// };
// src/controllers/orderController.js
// src/controllers/orderController.js
// src/controllers/orderController.js
// src/controllers/orderController.js
// src/controllers/orderController.js
// src/controllers/orderController.js (excerpt)



// src/controllers/orderController.js
// src/controllers/orderController.js
// src/controllers/orderController.js







// src/controllers/orderController.js
// src/controllers/orderController.js
import mongoose from "mongoose";
import Branch from "../models/Branch.js";
import Order from "../models/Order.js";
import MenuItem from "../models/MenuItem.js"; 
import crypto from "crypto";
import { nextSeqByKey } from "../models/Counter.js";

// ---------- helpers ----------
function leftPad(value, size) {
  const s = String(value ?? "");
  return s.length >= size ? s : "0".repeat(size - s.length) + s;
}
function digitsAtEnd(s) {
  const m = String(s || "").match(/(\d+)$/);
  return m ? m[1] : "";
}
function vendorDigits2(vendorId) {
  const d = digitsAtEnd(vendorId);
  return leftPad(d.slice(-2) || "0", 2);
}
function branchDigits5(branchId) {
  const d = digitsAtEnd(branchId);
  return leftPad(d.slice(-5) || "0", 5);
}
/** format a JS Date as YYYY,MM,DD in a target IANA tz */
function tzPartsOf(date, tz = "UTC") {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "00";
  const d = parts.find((p) => p.type === "day")?.value ?? "00";
  return { y, m, d, ymd: `${y}${m}${d}` };
}
/** today in tz -> {y,m,d,ymd} */
function tzToday(tz = "UTC") {
  return tzPartsOf(new Date(), tz);
}
/** parse "YYYY-MM-DD" -> "YYYYMMDD" */
function parseDateStrToYmd(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ""));
  if (!m) return null;
  return `${m[1]}${m[2]}${m[3]}`;
}
/** add days to a YYYYMMDD and return YYYYMMDD (tz-neutral) */
function addDaysYmd(ymd, days) {
  const y = parseInt(ymd.slice(0, 4), 10);
  const m = parseInt(ymd.slice(4, 6), 10);
  const d = parseInt(ymd.slice(6, 8), 10);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + days);
  const yy = base.getUTCFullYear().toString().padStart(4, "0");
  const mm = (base.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = base.getUTCDate().toString().padStart(2, "0");
  return `${yy}${mm}${dd}`;
}
/** build inclusive orderNumber range using lexicographic bounds */
function orderNumberRange(fromYmd, toYmd) {
  // orderNumber is 8(date)+2+5+7 = 22 digits -> suffix length after ymd = 14
  const SUF0 = "00000000000000";
  const SUF9 = "99999999999999";
  return {
    $gte: `${fromYmd}${SUF0}`,
    $lte: `${toYmd}${SUF9}`,
  };
}
/** compute inclusive [fromYmd, toYmd] from period/date/dateFrom/dateTo */
async function resolveRange({ period, dateStr, dateFrom, dateTo, tz }) {
  // if custom provided => inclusive [from,to]
  const fromY = parseDateStrToYmd(dateFrom);
  const toY = parseDateStrToYmd(dateTo);

  if (fromY && toY) {
    // ensure order
    return (fromY <= toY) ? { fromYmd: fromY, toYmd: toY, period: "custom" }
                          : { fromYmd: toY, toYmd: fromY, period: "custom" };
  }

  // base day (in tz)
  let baseYmd = parseDateStrToYmd(dateStr);
  if (!baseYmd) baseYmd = tzToday(tz).ymd;

  if (period === "week") {
    // last 7 days inclusive [base-6, base]
    const from = addDaysYmd(baseYmd, -6);
    return { fromYmd: from, toYmd: baseYmd, period: "week" };
  }
  if (period === "month") {
    // last 30 days inclusive [base-29, base]
    const from = addDaysYmd(baseYmd, -29);
    return { fromYmd: from, toYmd: baseYmd, period: "month" };
  }
  // default: day
  return { fromYmd: baseYmd, toYmd: baseYmd, period: "day" };
}

// ============ PUBLIC: place order (no token) ============

// ============ PUBLIC: place order (server-calculated pricing) ============
export const createOrder = async (req, res) => {
  try {
    const {
      branch: branchCode,
      qr,
      currency,
      customer,
      items,
      remarks,
      source = "customer_view",
      clientCreatedAt,
      clientTzOffsetMinutes,
    } = req.body || {};

    if (!branchCode) return res.status(400).json({ error: "Missing branch" });
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "No items" });
    }

    const branch = await Branch.findOne({ branchId: branchCode }).lean();
    if (!branch) return res.status(404).json({ error: "Branch not found" });

    // ✅ authoritative tax settings from branch
    const taxes = (branch.taxes && typeof branch.taxes === "object") ? branch.taxes : {};
    const vatPercent = Number(taxes.vatPercentage ?? 0) || 0;
    const serviceChargePercent = Number(taxes.serviceChargePercentage ?? 0) || 0;
    const isVatInclusive = taxes.isVatInclusive === true;

    const vendorId = branch.vendorId;
    const tz = branch.timeZone || "UTC";
    const { y, m, d, ymd } = tzPartsOf(new Date(), tz);

    const round3 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 1000) / 1000;

    // --------------------------------------
    // 1) Build list of Mongo ObjectIds
    // --------------------------------------
    const rawIds = [...new Set(items.map((x) => String(x?.itemId || x?.id || "").trim()).filter(Boolean))];
    if (rawIds.length === 0) return res.status(400).json({ error: "Invalid items payload (no itemId)" });

    const objectIds = [];
    for (const id of rawIds) {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ error: "Invalid itemId", itemId: id });
      }
      objectIds.push(new mongoose.Types.ObjectId(id));
    }

    // ✅ fetch items AND enforce ownership (vendor/branch match) to prevent tampering
    const dbItems = await MenuItem.find({
      _id: { $in: objectIds },
      vendorId: vendorId,
      branchId: branch.branchId,
      isActive: true,
      isAvailable: true,
    }).lean();

    const itemMap = new Map(dbItems.map((it) => [String(it._id), it]));

    const missing = rawIds.filter((id) => !itemMap.has(id));
    if (missing.length) {
      return res.status(400).json({
        error: "Some items are not available for this branch/vendor",
        missing,
      });
    }

    // --------------------------------------
    // 2) Server-priced items
    // --------------------------------------
    const now = new Date();
    const orderItems = [];
    let subtotal = 0;

    // helper: apply discount to base price (not addons)
    function applyDiscount(base, discount) {
      if (!discount || typeof discount !== "object") return base;

      const type = String(discount.type || "").trim();
      const value = Number(discount.value ?? 0) || 0;
      const validUntil = discount.validUntil ? new Date(discount.validUntil) : null;

      if (validUntil && validUntil.getTime() < now.getTime()) return base; // expired
      if (!type || value <= 0) return base;

      if (type === "percentage") {
        const off = base * (value / 100);
        return Math.max(0, base - off);
      }
      if (type === "amount") {
        return Math.max(0, base - value);
      }
      return base;
    }

    for (const reqIt of items) {
      const mongoId = String(reqIt?.itemId || reqIt?.id || "").trim();
      const qty = Math.max(parseInt(reqIt?.quantity || "1", 10) || 1, 1);

      const dbIt = itemMap.get(mongoId);

      // ---- base price (size OR fixed/offered)
      let basePrice = 0;
      let sizeObj = null;

      if (dbIt.isSizedBased === true) {
        const sizeLabel = String(reqIt?.size?.label || reqIt?.sizeLabel || "").trim();
        if (!sizeLabel) {
          return res.status(400).json({ error: "Missing size for sized item", itemId: mongoId });
        }
        const sizes = Array.isArray(dbIt.sizes) ? dbIt.sizes : [];
        const matched = sizes.find((s) => String(s?.label || "").trim() === sizeLabel);
        if (!matched) {
          return res.status(400).json({ error: "Invalid size selected", itemId: mongoId, sizeLabel });
        }
        basePrice = Number(matched.price ?? 0) || 0;
        sizeObj = { label: sizeLabel, price: round3(basePrice) };
      } else {
        const offered = (dbIt.offeredPrice !== undefined) ? (Number(dbIt.offeredPrice) || 0) : 0;
        const fixed = Number(dbIt.fixedPrice ?? 0) || 0;
        basePrice = offered > 0 ? offered : fixed;
      }

      // ---- discount (applies to base)
      basePrice = applyDiscount(basePrice, dbIt.discount);

      // ---- addons validation by group+option label (because your schema has no option id)
      const reqAddons = Array.isArray(reqIt?.addons) ? reqIt.addons : [];

      // group label -> array of selected option labels
      const selectionsByGroup = new Map();
      for (const a of reqAddons) {
        const groupLabel = String(a?.groupLabel || a?.group || a?.addonGroup || "").trim();
        const optionLabel = String(a?.optionLabel || a?.label || "").trim();
        if (!optionLabel) {
          return res.status(400).json({ error: "Invalid addon (missing option label)", itemId: mongoId });
        }
        const key = groupLabel || "__default__";
        if (!selectionsByGroup.has(key)) selectionsByGroup.set(key, []);
        selectionsByGroup.get(key).push(optionLabel);
      }

      const finalAddons = [];
      let addonsTotal = 0;

      const addonGroups = Array.isArray(dbIt.addons) ? dbIt.addons : [];

      // validate each request selection against db groups
      for (const [groupKey, optionLabels] of selectionsByGroup.entries()) {
        // find group: match by label (case-insensitive). If groupKey == __default__, allow match across all groups.
        let group = null;

        if (groupKey !== "__default__") {
          group = addonGroups.find(
            (g) => String(g?.label || "").trim().toLowerCase() === groupKey.trim().toLowerCase()
          );
          if (!group) {
            return res.status(400).json({ error: "Invalid addon group", itemId: mongoId, groupLabel: groupKey });
          }
        }

        // enforce min/max when group exists
        if (group) {
          const min = Number(group.min ?? 0) || 0;
          const max = Number(group.max ?? 1) || 1;

          if (optionLabels.length < min) {
            return res.status(400).json({ error: "Addon group below min", itemId: mongoId, groupLabel: groupKey, min });
          }
          if (optionLabels.length > max) {
            return res.status(400).json({ error: "Addon group above max", itemId: mongoId, groupLabel: groupKey, max });
          }
        }

        // resolve options
        const allowedOptions = group
          ? (Array.isArray(group.options) ? group.options : [])
          : addonGroups.flatMap((g) => Array.isArray(g?.options) ? g.options : []);

        for (const optLabel of optionLabels) {
          const opt = allowedOptions.find(
            (o) => String(o?.label || "").trim().toLowerCase() === optLabel.trim().toLowerCase()
          );
          if (!opt) {
            return res.status(400).json({
              error: "Invalid addon option",
              itemId: mongoId,
              groupLabel: groupKey === "__default__" ? null : groupKey,
              optionLabel: optLabel,
            });
          }

          const price = Number(opt.price ?? 0) || 0;
          addonsTotal += price;

          // id field in Order.items.addons: use sku if exists else label
          finalAddons.push({
            id: String(opt.sku || opt.label || "").trim(),
            label: String(opt.label || "").trim(),
            price: round3(price),
          });
        }
      }

      // also enforce required groups even if user didn’t send them
      for (const g of addonGroups) {
        if (g?.required === true) {
          const key = String(g.label || "").trim().toLowerCase();
          const selectedCount = (selectionsByGroup.get(g.label) || selectionsByGroup.get(key) || []).length;

          const min = Number(g.min ?? 0) || 0;
          if (selectedCount < Math.max(1, min)) {
            return res.status(400).json({
              error: "Required addon group missing",
              itemId: mongoId,
              groupLabel: g.label,
            });
          }
        }
      }

      const unitBasePrice = round3(basePrice + addonsTotal);
      const lineTotal = round3(unitBasePrice * qty);
      subtotal = round3(subtotal + lineTotal);

      orderItems.push({
        itemId: mongoId, // ✅ store Mongo _id as string
        nameEnglish: dbIt.nameEnglish || "",
        nameArabic: dbIt.nameArabic || "",
        imageUrl: dbIt.imageUrl || "",
        isSizedBased: dbIt.isSizedBased === true,
        size: sizeObj, // {label, price} or null
        addons: finalAddons,
        unitBasePrice,
        quantity: qty,
        notes: String(reqIt?.notes || ""),
        lineTotal,
      });
    }

    // --------------------------------------
    // 3) Taxes & totals (server)
    // --------------------------------------
    const serviceChargeAmount = round3(subtotal * (serviceChargePercent / 100));
    const vatBase = round3(subtotal + serviceChargeAmount);

    let vatAmount = 0;
    let grandTotal = 0;
    let subtotalExVat = vatBase;

    if (vatPercent > 0) {
      if (isVatInclusive) {
        vatAmount = round3(vatBase * (vatPercent / (100 + vatPercent)));
        subtotalExVat = round3(vatBase - vatAmount);
        grandTotal = round3(vatBase);
      } else {
        vatAmount = round3(vatBase * (vatPercent / 100));
        subtotalExVat = round3(vatBase);
        grandTotal = round3(vatBase + vatAmount);
      }
    } else {
      vatAmount = 0;
      subtotalExVat = round3(vatBase);
      grandTotal = round3(vatBase);
    }

    const pricing = {
      subtotal: round3(subtotal),
      serviceChargePercent: round3(serviceChargePercent),
      serviceChargeAmount,
      vatPercent: round3(vatPercent),
      vatAmount,
      grandTotal,
      isVatInclusive,
      subtotalExVat,
    };

    let parsedClientCreatedAt = null;

    if (clientCreatedAt) {
    const dt = new Date(clientCreatedAt);
    if (!isNaN(dt.getTime())) {
    parsedClientCreatedAt = dt; // stored as UTC Date internally (Mongo)
    }
  }

    // offset minutes validation (optional, but recommended)
    let parsedOffset = null;
    if (clientTzOffsetMinutes !== undefined && clientTzOffsetMinutes !== null) {
    const off = Number(clientTzOffsetMinutes);
    // time zones are roughly between -840 and +840 minutes
    if (!Number.isNaN(off) && off >= -840 && off <= 840) {
    parsedOffset = off;
  }
}

const publicToken = crypto.randomBytes(16).toString("hex"); // 32 chars


    // --------------------------------------
    // 4) Create order (your existing orderNumber/token logic)
    // --------------------------------------
    const baseDoc = {
      vendorId,
      branchId: branch.branchId,
      currency: (currency || branch.currency || "BHD").toString().trim(),
      qr: qr || null,
      customer: {
        name: customer?.name || "",
        phone: customer?.phone || null,
      },
      items: orderItems,
      pricing,
      remarks: remarks || null,
      source,
      status: "Pending",
      publicToken, // ✅ NEW
      clientCreatedAt: parsedClientCreatedAt,
      clientTzOffsetMinutes: parsedOffset,

      // ✅ business timestamp (use client if available)
      placedAt: parsedClientCreatedAt || new Date(),
    };

    const counterKey = `orders:daily:${vendorId}:${branch.branchId}:${ymd}`;
    const MAX_RETRIES = 3;
    let lastErr = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const seq = await nextSeqByKey(counterKey);
      const v2 = vendorDigits2(vendorId);
      const b5 = branchDigits5(branch.branchId);
      const orderNumber = `${y}${m}${d}${v2}${b5}${leftPad(seq, 7)}`;
      const tokenNumber = seq;

      try {
        const created = await Order.create({
          ...baseDoc,
          orderNumber,
          tokenNumber,
        });

        return res.status(201).json({
          message: "Order placed",
          order: {
            id: String(created._id),
            orderNumber: created.orderNumber,
            tokenNumber: created.tokenNumber,
            publicToken: created.publicToken, // ✅ NEW
            vendorId: created.vendorId,
            branchId: created.branchId,
            currency: created.currency,
            status: created.status,
            qr: created.qr,
            customer: created.customer,
            items: created.items,
            pricing: created.pricing,
            remarks: created.remarks ?? null,
            source: created.source ?? "customer_view",
            createdAt: created.createdAt,
            placedAt: created.placedAt,
            clientCreatedAt: created.clientCreatedAt,
            clientTzOffsetMinutes: created.clientTzOffsetMinutes,
          },
        });
      } catch (e) {
        if (e && e.code === 11000 && e.keyPattern && e.keyPattern.orderNumber) {
          lastErr = e;
          continue;
        }
        throw e;
      }
    }

    return res.status(409).json({
      error: "Could not allocate a unique order number after retries",
      details: lastErr?.message || null,
    });
  } catch (err) {
    console.error("createOrder error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};

export const getPublicOrderById = async (req, res) => {
  try {
    const { id } = req.params;
    const token = String(req.query.token || "").trim();

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid order id" });
    }
    if (!token) {
      return res.status(400).json({ error: "Missing token" });
    }

    const order = await Order.findById(id).lean();
    if (!order) return res.status(404).json({ error: "Order not found" });

    if (String(order.publicToken || "") !== token) {
      return res.status(403).json({ error: "Invalid token" });
    }

    return res.status(200).json({
      order: {
        id: String(order._id),
        orderNumber: order.orderNumber,
        tokenNumber: order.tokenNumber,
        branchId: order.branchId,
        currency: order.currency,
        status: order.status,
        qr: order.qr,
        customer: order.customer,
        items: order.items,
        pricing: order.pricing,
        remarks: order.remarks ?? null,
        source: order.source ?? "customer_view",
        placedAt: order.placedAt ?? null,
        createdAt: order.createdAt ?? null,
      },
    });
  } catch (err) {
    console.error("getPublicOrderById error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};


// export const createOrder = async (req, res) => {
//   try {
//     const {
//       branch: branchCode,
//       qr,
//       currency,
//       customer,
//       items,
//       pricing, // client-provided for now
//       remarks,
//       source = "customer_view",
//     } = req.body || {};

//     if (!branchCode) return res.status(400).json({ error: "Missing branch" });
//     if (!Array.isArray(items) || items.length === 0)
//       return res.status(400).json({ error: "No items" });
//     if (!pricing) return res.status(400).json({ error: "Missing pricing object" });

//     const branch = await Branch.findOne({ branchId: branchCode }).lean();
//     if (!branch) return res.status(404).json({ error: "Branch not found" });

//     const vendorId = branch.vendorId;
//     const tz = branch.timeZone || "UTC";
//     const { y, m, d, ymd } = tzPartsOf(new Date(), tz);

//     // Base doc shared across attempts
//     const baseDoc = {
//       vendorId,
//       branchId: branch.branchId,
//       currency: currency || branch.currency || "BHD",
//       qr: qr || null,
//       customer: {
//         name: customer?.name || "",
//         phone: customer?.phone || null,
//       },
//       items,
//       pricing,
//       remarks: remarks || null,
//       source,
//       status: "Pending",
//     };

//     // One counter per vendor+branch+day
//     const counterKey = `orders:daily:${vendorId}:${branch.branchId}:${ymd}`;

//     const MAX_RETRIES = 3;
//     let lastErr = null;

//     for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
//       // Allocate ONE atomic sequence number for this day
//       const seq = await nextSeqByKey(counterKey); // 1, 2, 3, ...
//       const v2 = vendorDigits2(vendorId);
//       const b5 = branchDigits5(branch.branchId);
//       const orderNumber = `${y}${m}${d}${v2}${b5}${leftPad(seq, 7)}`;
//       const tokenNumber = seq; // <-- token == daily seq

//       try {
//         const created = await Order.create({
//           ...baseDoc,
//           orderNumber,
//           tokenNumber,
//         });

//         // Return detailed order payload
//         return res.status(201).json({
//           message: "Order placed",
//           order: {
//             id: String(created._id),
//             orderNumber: created.orderNumber,
//             tokenNumber: created.tokenNumber,
//             vendorId: created.vendorId,
//             branchId: created.branchId,
//             currency: created.currency,
//             status: created.status,
//             qr: created.qr,
//             customer: created.customer,
//             items: created.items,
//             pricing: created.pricing,
//             remarks: created.remarks ?? null,
//             source: created.source ?? "customer_view",
//             createdAt: created.createdAt,
//           },
//         });
//       } catch (e) {
//         // Rare collision protection (shouldn't happen with atomic counter, but safe)
//         if (e && e.code === 11000 && e.keyPattern && e.keyPattern.orderNumber) {
//           lastErr = e;
//           continue; // try again with a new seq
//         }
//         throw e;
//       }
//     }

//     return res.status(409).json({
//       error: "Could not allocate a unique order number after retries",
//       details: lastErr?.message || null,
//     });
//   } catch (err) {
//     console.error("createOrder error:", err);
//     return res.status(500).json({ error: err.message || "Server error" });
//   }


// };

// ============ PROTECTED/ADMIN: list + summary ============
/**
 * GET /api/orders
 * Query:
 * - vendor: V000023 (recommended) OR branch: BR-000004 (at least one required)
 * - branch: BR-000004 (optional)
 * - period: day|week|month|custom (default day)
 * - date: YYYY-MM-DD (base day for day/week/month)
 * - dateFrom, dateTo: YYYY-MM-DD (used when period=custom) — INCLUSIVE
 * - tz: IANA tz (e.g., "Asia/Bahrain"). If not provided and branch is given, falls back to branch.timeZone. Else "UTC".
 * - status: Pending|Accepted|Completed|Cancelled (optional)
 * - sort: newest|oldest (default newest)
 * - page, limit
 */
export const getOrders = async (req, res) => {
  try {
    const vendorId = (req.query.vendor || "").toString().trim();
    const branchId = (req.query.branch || "").toString().trim();

    if (!vendorId && !branchId) {
      return res.status(400).json({ error: "Provide at least vendor or branch in query" });
    }

    let tz = (req.query.tz || "").toString().trim();
    let branchDoc = null;
    if (!tz && branchId) {
      branchDoc = await Branch.findOne({ branchId }).lean();
      tz = branchDoc?.timeZone || "UTC";
    }
    if (!tz) tz = "UTC";

    const period = (req.query.period || "day").toString().trim();
    const dateStr = (req.query.date || "").toString().trim();
    const dateFrom = (req.query.dateFrom || "").toString().trim();
    const dateTo = (req.query.dateTo || "").toString().trim();

    const status = (req.query.status || "").toString().trim();
    const sort = (req.query.sort || "newest").toString().trim();

    const page = Math.max(parseInt(req.query.page || "1", 10) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit || "20", 10) || 20, 200);
    const skip = (page - 1) * limit;

    // Inclusive date range resolved in the branch/user timezone,
    // then applied lexicographically on orderNumber prefix.
    const { fromYmd, toYmd, period: periodUsed } = await resolveRange({
      period,
      dateStr,
      dateFrom,
      dateTo,
      tz,
    });

    const q = {
      orderNumber: orderNumberRange(fromYmd, toYmd),
    };
    if (vendorId) q.vendorId = vendorId;
    if (branchId) q.branchId = branchId;
    if (status) {
      // case-insensitive match
      q.status = new RegExp(`^${status}$`, "i");
    }

    const sortSpec = sort === "oldest" ? { createdAt: 1 } : { createdAt: -1 };

    // Pull page
    const [orders, totalCount] = await Promise.all([
      Order.find(q).sort(sortSpec).skip(skip).limit(limit).lean(),
      Order.countDocuments(q),
    ]);

    // summary over returned page (fast). If you want full-range totals, aggregate on q.
    const ordersCount = orders.length;
    const totals = orders.reduce(
      (acc, o) => {
        const p = o?.pricing || {};
        acc.subtotal += Number(p?.subtotal || 0);
        acc.serviceCharge += Number(p?.serviceChargeAmount || 0);
        acc.vat += Number(p?.vatAmount || 0);
        acc.grand += Number(p?.grandTotal || 0);
        return acc;
      },
      { subtotal: 0, serviceCharge: 0, vat: 0, grand: 0 }
    );

    let firstToken = null;
    let lastToken = null;
    if (ordersCount > 0) {
      const tokens = orders
        .map((o) => Number(o.tokenNumber) || 0)
        .filter((n) => Number.isFinite(n) && n > 0);
      if (tokens.length) {
        firstToken = Math.min(...tokens);
        lastToken = Math.max(...tokens);
      }
    }

    const byStatusMap = new Map();
    for (const o of orders) {
      const s = (o.status || "Pending").toString();
      byStatusMap.set(s, (byStatusMap.get(s) || 0) + 1);
    }
    const byStatus = Array.from(byStatusMap.entries()).map(([s, c]) => ({
      status: s,
      count: c,
    }));

    return res.status(200).json({
      range: {
        period: periodUsed,
        tz,
        from: `${fromYmd.slice(0, 4)}-${fromYmd.slice(4, 6)}-${fromYmd.slice(6, 8)}`,
        to: `${toYmd.slice(0, 4)}-${toYmd.slice(4, 6)}-${toYmd.slice(6, 8)}`,
      },
      counts: { orders: ordersCount, totalMatched: totalCount },
      totals,
      tokens: { first: firstToken, last: lastToken },
      byStatus,
      orders: orders.map((o) => ({
        id: String(o._id),
        orderNumber: o.orderNumber,
        tokenNumber: o.tokenNumber ?? null,
        status: o.status || "Pending",
        vendorId: o.vendorId,
        branchId: o.branchId,
        currency: o.currency,
        pricing: o.pricing || null,
        customer: {
          name: o?.customer?.name || "",
          phone: o?.customer?.phone || null,
        },
        qr: o.qr || null,
        createdAt: o.createdAt, // UTC ISO
        items: o.items || [],   // keep for printing
      })),
      pagination: {
        page,
        limit,
        totalPages: Math.max(Math.ceil(totalCount / limit), 1),
      },
    });
  } catch (err) {
    console.error("getOrders error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};





// import admin from "../config/firebase.js";
// import Vendor from "../models/Vendor.js";
// import Branch from "../models/Branch.js";
// import Order from "../models/Order.js";
// import { nextSeqByKey, nextTokenForDay } from "../models/Counter.js";

// // ---------- helpers ----------
// function leftPad(value, size) {
//   const s = String(value ?? "");
//   return s.length >= size ? s : "0".repeat(size - s.length) + s;
// }
// function digitsAtEnd(s) {
//   const m = String(s || "").match(/(\d+)$/);
//   return m ? m[1] : "";
// }
// function vendorDigits2(vendorId) {
//   const d = digitsAtEnd(vendorId);
//   return leftPad(d.slice(-2) || "0", 2);
// }
// function branchDigits5(branchId) {
//   const d = digitsAtEnd(branchId);
//   return leftPad(d.slice(-5) || "0", 5);
// }
// function tzParts(tz = "UTC") {
//   const fmt = new Intl.DateTimeFormat("en-CA", {
//     timeZone: tz,
//     year: "numeric",
//     month: "2-digit",
//     day: "2-digit",
//   });
//   const parts = fmt.formatToParts(new Date());
//   const y = parts.find((p) => p.type === "year")?.value ?? "0000";
//   const m = parts.find((p) => p.type === "month")?.value ?? "00";
//   const d = parts.find((p) => p.type === "day")?.value ?? "00";
//   return { y, m, d, ymd: `${y}${m}${d}` };
// }
// function parseIntOr(v, d) {
//   const n = parseInt(String(v), 10);
//   return Number.isFinite(n) ? n : d;
// }
// function startEndForScope(scope, dateStr) {
//   const date = dateStr ? new Date(`${dateStr}T00:00:00.000Z`) : new Date();
//   const start = new Date(date);
//   let end;

//   if (scope === "week") {
//     const day = start.getUTCDay() || 7; // 1..7
//     start.setUTCDate(start.getUTCDate() - (day - 1));
//     start.setUTCHours(0, 0, 0, 0);
//     end = new Date(start);
//     end.setUTCDate(end.getUTCDate() + 7);
//     end.setUTCHours(0, 0, 0, 0);
//     end = new Date(end.getTime() - 1);
//   } else if (scope === "month") {
//     start.setUTCDate(1);
//     start.setUTCHours(0, 0, 0, 0);
//     end = new Date(start);
//     end.setUTCMonth(end.getUTCMonth() + 1);
//     end.setUTCHours(0, 0, 0, 0);
//     end = new Date(end.getTime() - 1);
//   } else {
//     start.setUTCHours(0, 0, 0, 0);
//     end = new Date(start);
//     end.setUTCDate(end.getUTCDate() + 1);
//     end.setUTCHours(0, 0, 0, 0);
//     end = new Date(end.getTime() - 1);
//   }
//   return { start, end };
// }

// // ---------- PUBLIC: place order (no token) ----------
// export const createOrder = async (req, res) => {
//   try {
//     const {
//       branch: branchCode,
//       qr,
//       currency,
//       customer,
//       items,
//       pricing, // must be provided by client for now
//       remarks,
//       source = "customer_view",
//     } = req.body || {};

//     if (!branchCode) return res.status(400).json({ error: "Missing branch" });
//     if (!Array.isArray(items) || items.length === 0) {
//       return res.status(400).json({ error: "No items" });
//     }
//     if (!pricing) return res.status(400).json({ error: "Missing pricing object" });

//     const branch = await Branch.findOne({ branchId: branchCode }).lean();
//     if (!branch) return res.status(404).json({ error: "Branch not found" });

//     const vendorId = branch.vendorId;
//     const tz = branch.timeZone || "UTC";
//     const { y, m, d, ymd } = tzParts(tz);

//     // Per-day small token (per branch)
//     const tokenNumber = await nextTokenForDay(ymd, branch.branchId); // <-- use local variable in response

//     // Per-day unique order number: YYYYMMDD + v2 + b5 + seq(7)
//     const v2 = vendorDigits2(vendorId);
//     const b5 = branchDigits5(branch.branchId);
//     const counterKey = `orders:daily:${vendorId}:${branch.branchId}:${ymd}`;

//     const baseDoc = {
//       vendorId,
//       branchId: branch.branchId,
//       currency: currency || branch.currency || "BHD",
//       qr: qr || null,
//       customer: {
//         name: customer?.name || "",
//         phone: customer?.phone || null,
//       },
//       items,
//       pricing, // (you can re-check totals server-side later)
//       remarks: remarks || null,
//       source,
//       status: "Pending",
//       tokenNumber, // <-- will be saved if Order schema has this field
//     };

//     const MAX_RETRIES = 3;
//     let lastErr = null;

//     for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
//       const seq = await nextSeqByKey(counterKey); // 1,2,3...
//       const orderNumber = `${y}${m}${d}${v2}${b5}${leftPad(seq, 7)}`;

//       try {
//         const created = await Order.create({ ...baseDoc, orderNumber });

//         // Build a full order payload for the client
//         return res.status(201).json({
//           message: "Order placed",
//           order: {
//             id: String(created._id),
//             orderNumber,           // from local var (guaranteed)
//             tokenNumber,           // from local var (always present)
//             vendorId,
//             branchId: branch.branchId,
//             currency: baseDoc.currency,
//             status: created.status,
//             qr: baseDoc.qr,
//             customer: baseDoc.customer,
//             items: baseDoc.items,
//             pricing: baseDoc.pricing,
//             remarks: baseDoc.remarks,
//             source: baseDoc.source,
//             createdAt: created.createdAt,
//           },
//         });
//       } catch (e) {
//         if (e && e.code === 11000 && e.keyPattern && e.keyPattern.orderNumber) {
//           lastErr = e;
//           continue; // try a new seq
//         }
//         throw e;
//       }
//     }

//     return res.status(409).json({
//       error: "Could not allocate a unique order number after retries",
//       details: lastErr?.message || null,
//     });
//   } catch (err) {
//     console.error("createOrder error:", err);
//     return res.status(500).json({ error: err.message || "Server error" });
//   }
// };

// // Back-compat alias if referenced elsewhere
// export const placePublicOrder = createOrder;

// // ---------- PROTECTED: list + summary (Bearer token) ----------
// export const getOrders = async (req, res) => {
//   try {
//     // 1) Auth
//     const h = req.headers?.authorization || "";
//     const m = /^Bearer\s+(.+)$/i.exec(h);
//     const token = m ? m[1] : null;
//     if (!token) return res.status(401).json({ error: "Unauthorized - No token provided" });

//     const decoded = await admin.auth().verifyIdToken(token);
//     const userId = decoded.uid;

//     // Resolve vendor from user
//     const vendor = await Vendor.findOne({ userId }).lean();
//     if (!vendor) return res.status(403).json({ error: "No vendor associated with this account" });

//     // 2) Query params
//     const vendorIdParam = (req.query.vendor || "").toString().trim();
//     const branchIdParam = (req.query.branch || "").toString().trim();
//     const statusParam = (req.query.status || "").toString().trim();
//     const scope = (req.query.scope || "day").toString().trim().toLowerCase(); // day|week|month
//     const dateStr = (req.query.date || "").toString().trim(); // YYYY-MM-DD (UTC)
//     const page = Math.max(1, parseIntOr(req.query.page, 1));
//     const limit = Math.min(100, Math.max(1, parseIntOr(req.query.limit, 20)));

//     // Enforce vendor ownership
//     const vendorId = vendorIdParam && vendorIdParam === vendor.vendorId
//       ? vendorIdParam
//       : vendor.vendorId;

//     // Branch validation (optional)
//     let tz = "UTC";
//     if (branchIdParam) {
//       const branch = await Branch.findOne({ branchId: branchIdParam }).lean();
//       if (!branch) return res.status(404).json({ error: "Branch not found" });
//       if (branch.vendorId !== vendorId) {
//         return res.status(403).json({ error: "Branch does not belong to your vendor" });
//       }
//       tz = branch.timeZone || "UTC";
//     }

//     // 3) Date range (UTC)
//     const { start, end } = startEndForScope(scope, dateStr);

//     // 4) Query
//     const q = { vendorId, createdAt: { $gte: start, $lte: end } };
//     if (branchIdParam) q.branchId = branchIdParam;
//     if (statusParam) q.status = statusParam;

//     // 5) Count + list
//     const total = await Order.countDocuments(q);
//     const totalPages = Math.max(1, Math.ceil(total / limit));
//     const items = await Order.find(q)
//       .sort({ createdAt: -1 })
//       .skip((page - 1) * limit)
//       .limit(limit)
//       .lean();

//     // 6) Summary
//     const byStatusAgg = await Order.aggregate([
//       { $match: q },
//       { $group: { _id: "$status", count: { $sum: 1 }, total: { $sum: "$pricing.grandTotal" } } },
//       { $sort: { _id: 1 } },
//     ]);

//     const byStatus = byStatusAgg.map((g) => ({
//       status: g._id,
//       count: g.count,
//       total: Number(g.total || 0),
//     }));
//     const grandTotal = byStatus.reduce((s, x) => s + Number(x.total || 0), 0);

//     let tokens = { first: null, last: null };
//     if (scope === "day") {
//       const firstTokenDoc = await Order.find(q).sort({ tokenNumber: 1 }).limit(1).lean();
//       const lastTokenDoc = await Order.find(q).sort({ tokenNumber: -1 }).limit(1).lean();
//       tokens = {
//         first: firstTokenDoc[0]?.tokenNumber ?? null,
//         last: lastTokenDoc[0]?.tokenNumber ?? null,
//       };
//     }

//     return res.status(200).json({
//       dateRange: {
//         scope,
//         date: dateStr || null,
//         startISO: start.toISOString(),
//         endISO: end.toISOString(),
//         timeZone: tz,
//       },
//       vendorId,
//       branchId: branchIdParam || null,
//       page,
//       limit,
//       total,
//       totalPages,
//       ordersCount: total,
//       grandTotal: Number(grandTotal || 0),
//       tokens,
//       byStatus,
//       items,
//     });
//   } catch (err) {
//     console.error("getOrders error:", err);
//     return res.status(500).json({ error: err.message || "Server error" });
//   }
// };






