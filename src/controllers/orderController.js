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
import Branch from "../models/Branch.js";
import Order from "../models/Order.js";
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
export const createOrder = async (req, res) => {
  try {
    const {
      branch: branchCode,
      qr,
      currency,
      customer,
      items,
      pricing, // client-provided for now
      remarks,
      source = "customer_view",
    } = req.body || {};

    if (!branchCode) return res.status(400).json({ error: "Missing branch" });
    if (!Array.isArray(items) || items.length === 0)
      return res.status(400).json({ error: "No items" });
    if (!pricing) return res.status(400).json({ error: "Missing pricing object" });

    const branch = await Branch.findOne({ branchId: branchCode }).lean();
    if (!branch) return res.status(404).json({ error: "Branch not found" });

    const vendorId = branch.vendorId;
    const tz = branch.timeZone || "UTC";
    const { y, m, d, ymd } = tzPartsOf(new Date(), tz);

    // Base doc shared across attempts
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
      pricing,
      remarks: remarks || null,
      source,
      status: "Pending",
    };

    // One counter per vendor+branch+day
    const counterKey = `orders:daily:${vendorId}:${branch.branchId}:${ymd}`;

    const MAX_RETRIES = 3;
    let lastErr = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      // Allocate ONE atomic sequence number for this day
      const seq = await nextSeqByKey(counterKey); // 1, 2, 3, ...
      const v2 = vendorDigits2(vendorId);
      const b5 = branchDigits5(branch.branchId);
      const orderNumber = `${y}${m}${d}${v2}${b5}${leftPad(seq, 7)}`;
      const tokenNumber = seq; // <-- token == daily seq

      try {
        const created = await Order.create({
          ...baseDoc,
          orderNumber,
          tokenNumber,
        });

        // Return detailed order payload
        return res.status(201).json({
          message: "Order placed",
          order: {
            id: String(created._id),
            orderNumber: created.orderNumber,
            tokenNumber: created.tokenNumber,
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
          },
        });
      } catch (e) {
        // Rare collision protection (shouldn't happen with atomic counter, but safe)
        if (e && e.code === 11000 && e.keyPattern && e.keyPattern.orderNumber) {
          lastErr = e;
          continue; // try again with a new seq
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






