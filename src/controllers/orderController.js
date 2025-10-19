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
import admin from "../config/firebase.js";
import Vendor from "../models/Vendor.js";
import Branch from "../models/Branch.js"; // used to derive vendorId from branchId for orderNumber
import Order from "../models/Order.js";
import { nextSeqByKey, nextTokenForDay } from "../models/Counter.js";

/**
 * Helpers
 */
function digits(str = "") {
  const m = String(str || "").match(/\d+/);
  return m ? m[0] : "";
}

function padLeft(value, len) {
  const s = String(value ?? "");
  if (s.length >= len) return s.slice(-len);
  return s.padStart(len, "0");
}

function todayUTC() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  return new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
}

function rangeForPeriod({ period = "day", date, from, to }) {
  // All UTC boundaries
  if (period === "range" && from && to) {
    const start = new Date(from);
    const end = new Date(to);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new Error("Invalid from/to date");
    }
    // make end exclusive
    const endExclusive = new Date(end.getTime());
    return { start, end: endExclusive };
  }

  // base date = provided date or today
  const base = date ? new Date(`${date}T00:00:00.000Z`) : todayUTC();
  if (Number.isNaN(base.getTime())) throw new Error("Invalid date");

  if (period === "week") {
    // ISO week: start from base's UTC Monday
    const day = base.getUTCDay() || 7; // 1..7 (Mon..Sun)
    const start = new Date(base);
    start.setUTCDate(base.getUTCDate() - (day - 1));
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 7);
    return { start, end };
  }

  if (period === "month") {
    const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
    const end = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 1));
    return { start, end };
  }

  // default: day
  const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  const end = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + 1));
  return { start, end };
}

/**
 * Build the formatted order number:
 * YYYYMMDD + vendorDigits + branchDigits(5) + counter(7)
 * - vendorDigits: digits from vendorId without leading zeros (e.g., V000023 -> "23")
 * - branchDigits(5): last 5 digits of the branch id digits (BR-000004 -> "00004")
 * - counter(7): daily incremental per (date + vendor + branch)
 */
async function buildOrderNumber({ branchBusinessId, vendorId }) {
  const now = new Date();
  const ymd =
    String(now.getUTCFullYear()) +
    padLeft(now.getUTCMonth() + 1, 2) +
    padLeft(now.getUTCDate(), 2);

  const vDigitsRaw = digits(vendorId); // e.g. "000023"
  const vNum = parseInt(vDigitsRaw || "0", 10); // 23
  const vendorDigits = String(Number.isFinite(vNum) ? vNum : 0); // "23"

  const bDigitsFull = digits(branchBusinessId || ""); // "000004"
  const branchDigits5 = padLeft(bDigitsFull, 5); // "00004" (last 5 digits)

  // Daily counter key per (date + vendor + branch)
  const orderCounter = await nextSeqByKey(
    `orderNo:${ymd}:${vendorDigits}:${branchDigits5}`
  );
  const counter7 = padLeft(orderCounter, 7);

  return `${ymd}${vendorDigits}${branchDigits5}${counter7}`;
}

/**
 * Public: Create an order (no auth).
 * Body matches the customer view payload.
 */
export const createOrder = async (req, res) => {
  try {
    const {
      branch,            // "BR-000004"
      qr,                // { type, number, qrId }
      currency,          // e.g. "BHD"
      customer,          // { name, phone? }
      items,             // array of line items (validated below)
      pricing,           // { subtotal, serviceChargePercent, serviceChargeAmount, vatPercent, vatAmount, grandTotal }
      remarks,           // optional
      source = "customer_view",
    } = req.body || {};

    if (!branch || typeof branch !== "string") {
      return res.status(400).json({ error: 'Missing "branch" (business id like BR-000004)' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Order must include at least one item" });
    }
    if (!pricing || typeof pricing !== "object") {
      return res.status(400).json({ error: "Missing pricing object" });
    }

    // Look up branch to derive vendorId for order number + (optionally) timezone.
    const branchDoc = await Branch.findOne({ branchId: branch }).lean();
    if (!branchDoc) {
      return res.status(404).json({ error: "Branch not found" });
    }
    const vendorId = branchDoc.vendorId;

    // Build order number + daily branch token
    const orderNumber = await buildOrderNumber({
      branchBusinessId: branch,
      vendorId,
    });

    const now = new Date();
    const ymd =
      String(now.getUTCFullYear()) +
      padLeft(now.getUTCMonth() + 1, 2) +
      padLeft(now.getUTCDate(), 2);

    // daily token per (date + branch)
    const token = await nextTokenForDay(ymd, branch);

    // Normalize items minimally
    const normalizedItems = items.map((it) => ({
      itemId: String(it.itemId || ""),
      nameEnglish: String(it.nameEnglish || ""),
      nameArabic: String(it.nameArabic || ""),
      imageUrl: typeof it.imageUrl === "string" ? it.imageUrl : "",
      isSizedBased: Boolean(it.isSizedBased),
      size: it.size ? {
        label: String(it.size.label || ""),
        price: typeof it.size.price === "number" ? it.size.price : null,
      } : null,
      addons: Array.isArray(it.addons) ? it.addons.map((a) => ({
        id: String(a.id || a._id || ""),
        label: String(a.label || a.nameEnglish || a.nameArabic || ""),
        price: typeof a.price === "number" ? a.price : 0,
      })) : [],
      unitBasePrice: typeof it.unitBasePrice === "number" ? it.unitBasePrice : 0,
      quantity: Number.isFinite(it.quantity) && it.quantity > 0 ? it.quantity : 1,
      notes: typeof it.notes === "string" ? it.notes : "",
      lineTotal: typeof it.lineTotal === "number" ? it.lineTotal : 0,
    }));

    const orderDoc = await Order.create({
      // FK-ish
      vendorId,                 // from branch lookup
      branchId: branch,         // store business id

      // QR context if you want it stored
      qr: qr || null,           // { type, number, qrId }

      // Customer/Amounts
      currency: currency || branchDoc.currency || "BHD",
      customer: {
        name: customer?.name || "",
        phone: customer?.phone || null,
      },
      items: normalizedItems,
      pricing: {
        subtotal: Number(pricing.subtotal || 0),
        serviceChargePercent: Number(pricing.serviceChargePercent || 0),
        serviceChargeAmount: Number(pricing.serviceChargeAmount || 0),
        vatPercent: Number(pricing.vatPercent || 0),
        vatAmount: Number(pricing.vatAmount || 0),
        grandTotal: Number(pricing.grandTotal || 0),
      },

      // Identity
      orderNumber,              // e.g., 2025101923000040000001
      token,                    // small daily token per branch
      tokenDate: ymd,           // helpful for day grouping

      // Meta
      remarks: typeof remarks === "string" ? remarks : null,
      source,
      status: "pending",        // default status; update flow can advance it

      // Timestamps
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return res.status(201).json({
      message: "Order placed",
      orderId: orderDoc._id,
      orderNumber: orderDoc.orderNumber,
      token: orderDoc.token,
      tokenDate: orderDoc.tokenDate,
      status: orderDoc.status,
      createdAt: orderDoc.createdAt,
    });
  } catch (err) {
    console.error("Create Order Error:", err);
    return res.status(500).json({ error: err.message });
  }
};

/**
 * Protected: Get orders + summary (admin/vendor)
 * Query:
 *   period=day|week|month|range   (default: day)
 *   date=YYYY-MM-DD               (base date for day/week/month)
 *   from=YYYY-MM-DD&to=YYYY-MM-DD (when period=range)
 *   branch=BR-000004              (optional filter)
 *   page=1&limit=50               (paging)
 *
 * Auth: Bearer <firebase-id-token>
 * We resolve vendorId from token -> Vendor.userId.
 */
export const getOrders = async (req, res) => {
  try {
    // 1) Auth
    const h = req.headers?.authorization || "";
    const m = /^Bearer\s+(.+)$/i.exec(h);
    const token = m ? m[1] : null;
    if (!token) return res.status(401).json({ error: "Unauthorized - No token provided" });
    const decoded = await admin.auth().verifyIdToken(token);
    const userId = decoded.uid;

    const vendor = await Vendor.findOne({ userId }).lean();
    if (!vendor) return res.status(403).json({ error: "No vendor associated with this account" });
    const vendorId = vendor.vendorId;

    // 2) Filters
    const {
      period = "day",
      date, from, to,
      branch,                      // BR-000xxx
      page = "1",
      limit = "50",
      status                       // optional single status filter
    } = req.query || {};

    const { start, end } = rangeForPeriod({ period, date, from, to });

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(String(limit), 10) || 50));

    const q = {
      vendorId,
      createdAt: { $gte: start, $lt: end },
    };
    if (branch) q.branchId = String(branch);
    if (status) q.status = String(status);

    // 3) Summary (count + totals)
    const summaryAgg = await Order.aggregate([
      { $match: q },
      {
        $group: {
          _id: null,
          ordersCount: { $sum: 1 },
          grandTotal: { $sum: "$pricing.grandTotal" },
          firstToken: { $min: "$token" },
          lastToken: { $max: "$token" },
        },
      },
    ]);

    const summary = summaryAgg[0] || {
      ordersCount: 0,
      grandTotal: 0,
      firstToken: null,
      lastToken: null,
    };

    // 4) List (paged, newest first)
    const orders = await Order.find(q)
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean();

    return res.status(200).json({
      // echo filters
      vendorId,
      branchId: branch || null,
      period,
      date: date || null,
      from: from || null,
      to: to || null,

      // summary
      summary: {
        ordersCount: summary.ordersCount,
        grandTotal: Number(summary.grandTotal || 0),
        tokens: {
          first: summary.firstToken,
          last: summary.lastToken,
        },
      },

      // list
      page: pageNum,
      limit: limitNum,
      results: orders.length,
      orders,
      range: {
        start: start.toISOString(),
        end: end.toISOString(),
      },
    });
  } catch (err) {
    console.error("Get Orders Error:", err);
    return res.status(500).json({ error: err.message });
  }
};
