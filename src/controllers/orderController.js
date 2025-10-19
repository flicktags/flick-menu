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
import admin from "../config/firebase.js";
import Vendor from "../models/Vendor.js";
import Branch from "../models/Branch.js";
import Order from "../models/Order.js";
import { nextSeqByKey, nextTokenForDay } from "../models/Counter.js";

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
function tzParts(tz = "UTC") {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "00";
  const d = parts.find((p) => p.type === "day")?.value ?? "00";
  return { y, m, d, ymd: `${y}${m}${d}` };
}
function parseIntOr(v, d) {
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : d;
}

// Barebones date-range helpers (UTC-based; good enough for now)
function startEndForScope(scope, dateStr) {
  // dateStr: "YYYY-MM-DD" (UTC date)
  // Returns { start: Date, end: Date }
  const date = dateStr ? new Date(`${dateStr}T00:00:00.000Z`) : new Date();
  const start = new Date(date);
  let end;

  if (scope === "week") {
    // ISO week: Monday start (approx using UTC)
    const day = start.getUTCDay() || 7; // 1..7
    start.setUTCDate(start.getUTCDate() - (day - 1));
    start.setUTCHours(0, 0, 0, 0);
    end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    end.setUTCHours(0, 0, 0, 0);
    end = new Date(end.getTime() - 1);
  } else if (scope === "month") {
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    end.setUTCHours(0, 0, 0, 0);
    end = new Date(end.getTime() - 1);
  } else {
    // day (default)
    start.setUTCHours(0, 0, 0, 0);
    end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    end.setUTCHours(0, 0, 0, 0);
    end = new Date(end.getTime() - 1);
  }
  return { start, end };
}

// ---------- PUBLIC: place order (no token) ----------
export const createOrder = async (req, res) => {
  try {
    const {
      branch: branchCode,
      qr,
      currency,
      customer,
      items,
      pricing, // must be provided by client for now
      remarks,
      source = "customer_view",
    } = req.body || {};

    if (!branchCode) return res.status(400).json({ error: "Missing branch" });
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "No items" });
    }
    if (!pricing) return res.status(400).json({ error: "Missing pricing object" });

    const branch = await Branch.findOne({ branchId: branchCode }).lean();
    if (!branch) return res.status(404).json({ error: "Branch not found" });

    const vendorId = branch.vendorId;
    const tz = branch.timeZone || "UTC";
    const { y, m, d, ymd } = tzParts(tz);

    // per-day small token (per branch)
    const tokenNumber = await nextTokenForDay(ymd, branch.branchId); // <— NOTE: (ymd, branchId)

    // per-day unique order number: YYYYMMDD + v2 + b5 + seq(7)
    const v2 = vendorDigits2(vendorId);
    const b5 = branchDigits5(branch.branchId);
    const counterKey = `orders:daily:${vendorId}:${branch.branchId}:${ymd}`;

    const baseDoc = {
      vendorId,
      branchId: branch.branchId,
      currency: currency || branch.currency || "BHD",
      qr: qr || null,
      customer: {
        name: customer?.name || "",
        phone: customer?.phone || null,
      },
      items,
      pricing, // (optionally you can recompute & validate here)
      remarks: remarks || null,
      source,
      status: "Pending",
      tokenNumber,
    };

    const MAX_RETRIES = 3;
    let lastErr = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const seq = await nextSeqByKey(counterKey); // 1,2,3...
      const orderNumber = `${y}${m}${d}${v2}${b5}${leftPad(seq, 7)}`;

      try {
        const created = await Order.create({ ...baseDoc, orderNumber });
        return res.status(201).json({
          message: "Order placed",
          orderId: String(created._id),
          orderNumber: created.orderNumber,
          tokenNumber: created.tokenNumber,
          status: created.status,
          createdAt: created.createdAt,
        });
      } catch (e) {
        // handle duplicate orderNumber (rare under concurrency)
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

// Keep backward compatibility if anything still imports this name
export const placePublicOrder = createOrder;

// ---------- PROTECTED: list + summary (Bearer token) ----------
export const getOrders = async (req, res) => {
  try {
    // 1) Auth
    const h = req.headers?.authorization || "";
    const m = /^Bearer\s+(.+)$/i.exec(h);
    const token = m ? m[1] : null;
    if (!token) return res.status(401).json({ error: "Unauthorized - No token provided" });

    const decoded = await admin.auth().verifyIdToken(token);
    const userId = decoded.uid;

    // Resolve vendor from user
    const vendor = await Vendor.findOne({ userId }).lean();
    if (!vendor) return res.status(403).json({ error: "No vendor associated with this account" });

    // 2) Query params
    const vendorIdParam = (req.query.vendor || "").toString().trim();
    const branchIdParam = (req.query.branch || "").toString().trim();
    const statusParam = (req.query.status || "").toString().trim();
    const scope = (req.query.scope || "day").toString().trim().toLowerCase(); // day|week|month
    const dateStr = (req.query.date || "").toString().trim(); // YYYY-MM-DD (UTC)
    const page = Math.max(1, parseIntOr(req.query.page, 1));
    const limit = Math.min(100, Math.max(1, parseIntOr(req.query.limit, 20)));

    // Enforce vendor ownership
    const vendorId = vendorIdParam && vendorIdParam === vendor.vendorId
      ? vendorIdParam
      : vendor.vendorId;

    // Optional: if branch query provided, validate it belongs to this vendor
    let tz = "UTC";
    if (branchIdParam) {
      const branch = await Branch.findOne({ branchId: branchIdParam }).lean();
      if (!branch) return res.status(404).json({ error: "Branch not found" });
      if (branch.vendorId !== vendorId) {
        return res.status(403).json({ error: "Branch does not belong to your vendor" });
      }
      tz = branch.timeZone || "UTC";
    }

    // 3) Date range (UTC-based; simple and predictable)
    const { start, end } = startEndForScope(scope, dateStr);

    // 4) Build query
    const q = {
      vendorId,
      createdAt: { $gte: start, $lte: end },
    };
    if (branchIdParam) q.branchId = branchIdParam;
    if (statusParam) q.status = statusParam;

    // 5) Count + list (paged)
    const total = await Order.countDocuments(q);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const items = await Order.find(q)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    // 6) Summary
    // byStatus
    const byStatusAgg = await Order.aggregate([
      { $match: q },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          total: { $sum: "$pricing.grandTotal" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const byStatus = byStatusAgg.map((g) => ({
      status: g._id,
      count: g.count,
      total: Number(g.total || 0),
    }));

    const grandTotal = byStatus.reduce((s, x) => s + Number(x.total || 0), 0);

    // tokens (only meaningful for daily scope; otherwise null)
    let tokens = { first: null, last: null };
    if (scope === "day") {
      const firstTokenDoc = await Order.find(q).sort({ tokenNumber: 1 }).limit(1).lean();
      const lastTokenDoc = await Order.find(q).sort({ tokenNumber: -1 }).limit(1).lean();
      tokens = {
        first: firstTokenDoc[0]?.tokenNumber ?? null,
        last: lastTokenDoc[0]?.tokenNumber ?? null,
      };
    }

    return res.status(200).json({
      dateRange: {
        scope,
        date: dateStr || null,
        startISO: start.toISOString(),
        endISO: end.toISOString(),
        timeZone: tz,
      },
      vendorId,
      branchId: branchIdParam || null,
      page,
      limit,
      total,
      totalPages,
      ordersCount: total,
      grandTotal: Number(grandTotal || 0),
      tokens,
      byStatus,
      items,
    });
  } catch (err) {
    console.error("getOrders error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};





// import Branch from "../models/Branch.js";
// import Order from "../models/Order.js";
// import { nextSeqByKey, nextTokenForDay } from "../models/Counter.js";

// // --- helpers for formatting IDs & TZ date ---
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
//   // keep last 2 digits (or pad to 2 if fewer)
//   return leftPad(d.slice(-2) || "0", 2);
// }
// function branchDigits5(branchId) {
//   const d = digitsAtEnd(branchId);
//   // keep last 5 digits (or pad to 5 if fewer)
//   return leftPad(d.slice(-5) || "0", 5);
// }
// function tzParts(tz = "UTC") {
//   // returns {y, m, d, ymd}
//   const fmt = new Intl.DateTimeFormat("en-CA", {
//     timeZone: tz,
//     year: "numeric",
//     month: "2-digit",
//     day: "2-digit",
//   });
//   const parts = fmt.formatToParts(new Date());
//   const y = parts.find(p => p.type === "year")?.value ?? "0000";
//   const m = parts.find(p => p.type === "month")?.value ?? "00";
//   const d = parts.find(p => p.type === "day")?.value ?? "00";
//   return { y, m, d, ymd: `${y}${m}${d}` };
// }

// // PUBLIC create (from customer view)
// export const placePublicOrder = async (req, res) => {
//   try {
//     // 1) Basic body
//     const {
//       branch: branchCode,
//       qr,
//       currency,
//       customer,
//       items,
//       pricing,      // MUST be provided by client; server will verify
//       remarks,
//       source = "customer_view",
//     } = req.body || {};

//     if (!branchCode) return res.status(400).json({ error: "Missing branch" });
//     if (!Array.isArray(items) || items.length === 0) {
//       return res.status(400).json({ error: "No items" });
//     }
//     if (!pricing) return res.status(400).json({ error: "Missing pricing object" });

//     // 2) Branch (to get vendor & taxes & timeZone)
//     const branch = await Branch.findOne({ branchId: branchCode }).lean();
//     if (!branch) return res.status(404).json({ error: "Branch not found" });

//     const vendorId = branch.vendorId;
//     const tz = branch.timeZone || "UTC";
//     const { y, m, d, ymd } = tzParts(tz);

//     // 3) Build token (small, per-day)
//     const tokenNumber = await nextTokenForDay(vendorId, branch.branchId, ymd); // 1,2,3,...

//     // 4) Build order number using per-day counter
//     const v2 = vendorDigits2(vendorId);           // "23"
//     const b5 = branchDigits5(branch.branchId);    // "00004"

//     const counterKey = `orders:daily:${vendorId}:${branch.branchId}:${ymd}`;

//     // Prepare the order doc (without orderNumber yet)
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
//       pricing,     // you may re-calc and verify here if you want – omitted for brevity
//       remarks: remarks || null,
//       source,
//       status: "Pending",
//       tokenNumber,         // small visible token for the day
//     };

//     // 5) Try-create with retry on duplicate orderNumber
//     const MAX_RETRIES = 3;
//     let lastErr = null;
//     for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
//       const seq = await nextSeqByKey(counterKey); // 1, 2, 3...
//       const orderNumber = `${y}${m}${d}${v2}${b5}${leftPad(seq, 7)}`;

//       try {
//         const created = await Order.create({
//           ...baseDoc,
//           orderNumber,
//         });

//         return res.status(201).json({
//           message: "Order placed",
//           orderId: String(created._id),
//           orderNumber: created.orderNumber,
//           tokenNumber: created.tokenNumber,
//           status: created.status,
//           createdAt: created.createdAt,
//         });
//       } catch (e) {
//         // Handle duplicate 'orderNumber' (race) and retry
//         if (e && e.code === 11000 && e.keyPattern && e.keyPattern.orderNumber) {
//           lastErr = e;
//           continue; // get a new seq and try again
//         }
//         // Any other error => bail
//         throw e;
//       }
//     }

//     // If we got here, it kept colliding (very unlikely)
//     return res.status(409).json({
//       error: "Could not allocate a unique order number after retries",
//       details: lastErr?.message || null,
//     });
//   } catch (err) {
//     console.error("Place order error:", err);
//     return res.status(500).json({ error: err.message || "Server error" });
//   }
// };
