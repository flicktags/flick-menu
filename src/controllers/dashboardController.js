// // // controllers/dashboardController.js
// // controllers/dashboardController.js
// controllers/dashboardController.js
import Branch from "../models/Branch.js";
import Vendor from "../models/Vendor.js";
import MenuItem from "../models/MenuItem.js";
import Order from "../models/Order.js";

// ---------------- same ownership helper ----------------
async function userOwnsBranch(req, branch) {
  const uid = req.user?.uid;
  if (!uid || !branch) return false;

  if (branch.userId === uid) return true;

  const vendor = await Vendor.findOne({ vendorId: branch.vendorId }).lean();
  if (vendor && vendor.userId === uid) return true;

  return false;
}

// -----------------------------
// Helpers
// -----------------------------
function pad2(n) {
  return String(n).padStart(2, "0");
}

function parseDateStrYYYYMMDD(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || "").trim());
  if (!m) return null;
  return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) };
}

function ymdFromParts({ y, mo, d }) {
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

function addDaysUTC(y, mo, d, deltaDays) {
  const dt = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0)); // noon anchor
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/**
 * Compute timezone offset minutes at given UTC date for a tz.
 * Returns minutes to add to UTC to get local time. (e.g. Bahrain => +180)
 */
function tzOffsetMinutesAt(utcDate, tz) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = fmt.formatToParts(utcDate);
  const get = (type) => parts.find((p) => p.type === type)?.value;

  const y = Number(get("year"));
  const m = Number(get("month"));
  const d = Number(get("day"));
  const hh = Number(get("hour"));
  const mm = Number(get("minute"));
  const ss = Number(get("second"));

  // Treat that wall-clock as UTC, compare to actual UTC => derive offset
  const asUTC = Date.UTC(y, m - 1, d, hh, mm, ss);
  const actualUTC = utcDate.getTime();
  return Math.round((asUTC - actualUTC) / 60000);
}

/**
 * Convert a local date-time in tz -> UTC Date
 * local: {y,mo,d,hh,mm,ss}
 */
function zonedLocalToUtc({ y, mo, d, hh = 0, mm = 0, ss = 0 }, tz) {
  const guess = new Date(Date.UTC(y, mo - 1, d, hh, mm, ss));
  const off = tzOffsetMinutesAt(guess, tz);
  // local = utc + off => utc = local - off
  return new Date(guess.getTime() - off * 60000);
}

/** Today in tz as "YYYY-MM-DD" */
function todayLocalYmd(tz) {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(now); // "YYYY-MM-DD"
}

/**
 * Resolve BUSINESS DATE RANGE using businessDayLocal strings.
 *
 * Supported:
 * - period=day|week|month|year
 * - date=YYYY-MM-DD (anchor/end date)
 * - dateFrom/dateTo for custom (inclusive)
 */
function resolveBusinessDateRange({ period, date, dateFrom, dateTo, tz }) {
  const fromParsed = parseDateStrYYYYMMDD(dateFrom);
  const toParsed = parseDateStrYYYYMMDD(dateTo);

  if (fromParsed && toParsed) {
    const a = ymdFromParts(fromParsed);
    const b = ymdFromParts(toParsed);
    const fromLocal = a <= b ? a : b;
    const toLocal = a <= b ? b : a;
    return { fromLocal, toLocal, resolvedPeriod: "custom" };
  }

  const baseYmd = parseDateStrYYYYMMDD(date) ? date : todayLocalYmd(tz);
  const baseParsed = parseDateStrYYYYMMDD(baseYmd);
  const p = String(period || "day").toLowerCase();

  if (!baseParsed) {
    const t = todayLocalYmd(tz);
    return { fromLocal: t, toLocal: t, resolvedPeriod: "day" };
  }

  if (p === "day") {
    return { fromLocal: baseYmd, toLocal: baseYmd, resolvedPeriod: "day" };
  }

  if (p === "week") {
    const from = addDaysUTC(baseParsed.y, baseParsed.mo, baseParsed.d, -6);
    return { fromLocal: ymdFromParts(from), toLocal: baseYmd, resolvedPeriod: "week" };
  }

  if (p === "month") {
    const from = addDaysUTC(baseParsed.y, baseParsed.mo, baseParsed.d, -29);
    return { fromLocal: ymdFromParts(from), toLocal: baseYmd, resolvedPeriod: "month" };
  }

  if (p === "year") {
    const from = addDaysUTC(baseParsed.y, baseParsed.mo, baseParsed.d, -364);
    return { fromLocal: ymdFromParts(from), toLocal: baseYmd, resolvedPeriod: "year" };
  }

  // fallback day
  return { fromLocal: baseYmd, toLocal: baseYmd, resolvedPeriod: "day" };
}

// ---- optional: compute an operational window if there are ZERO orders (day view)
// uses branch.openingHours["Mon"] = "09:00-01:00" style
function parseHoursRange(str) {
  if (!str || typeof str !== "string") return null;
  const s = str.trim();
  const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  return {
    openH: Number(m[1]),
    openM: Number(m[2]),
    closeH: Number(m[3]),
    closeM: Number(m[4]),
    openStr: `${m[1]}:${m[2]}`,
    closeStr: `${m[3]}:${m[4]}`,
  };
}
function minsFromHM(h, m) {
  return h * 60 + m;
}
function weekdayKeyForLocalYmd(ymd, tz) {
  const p = parseDateStrYYYYMMDD(ymd);
  if (!p) return null;
  const localMidUTC = zonedLocalToUtc({ ...p, hh: 0, mm: 0, ss: 0 }, tz);
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(localMidUTC);
}
function computeBusinessWindowForLocalYmd({ ymd, tz, openingHours }) {
  const dayKey = weekdayKeyForLocalYmd(ymd, tz); // "Mon"... "Sun"
  if (!dayKey) return null;

  const rangeStr = openingHours?.[dayKey];
  const parsed = parseHoursRange(rangeStr);
  if (!parsed) return null;

  const base = parseDateStrYYYYMMDD(ymd);
  if (!base) return null;

  const startUTC = zonedLocalToUtc(
    { ...base, hh: parsed.openH, mm: parsed.openM, ss: 0 },
    tz
  );

  const openMin = minsFromHM(parsed.openH, parsed.openM);
  const closeMin = minsFromHM(parsed.closeH, parsed.closeM);

  const closeDate = (closeMin <= openMin)
    ? addDaysUTC(base.y, base.mo, base.d, 1) // next local day
    : base;

  const endUTC = zonedLocalToUtc(
    { ...closeDate, hh: parsed.closeH, mm: parsed.closeM, ss: 0 },
    tz
  );

  return {
    businessDayLocal: ymd,
    businessDayStartUTC: startUTC,
    businessDayEndUTC: endUTC,
    businessWindowLabel: `${dayKey} ${parsed.openStr}-${parsed.closeStr}`,
  };
}

function parseHHmm(s) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

// ---------------- GET /api/dashboard/summary?branchId=BR-000009 ----------------
// Optional params:
//  period=day|week|month|year|custom
//  date=YYYY-MM-DD
//  dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
//  shiftFrom=HH:mm&shiftTo=HH:mm  (optional, wraps midnight supported)
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

    // ----------------------------
    // EXISTING MENU + ITEMS STATS (KEEP)
    // ----------------------------
    const enabledSections = (branch.menuSections || []).filter(
      (s) => s && s.isEnabled === true
    );

    const totalSections = (branch.menuSections || []).length;
    const enabledSectionsCount = enabledSections.length;
    const enabledMenuTypesCount = enabledSectionsCount;

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

    const lastMenuUpdate =
      branch.menuStampAt ||
      branch.menuUpdatedAt ||
      branch.updatedAt ||
      null;

    // ----------------------------
    // ORDER STATS (BUSINESS DAY BASED)
    // ----------------------------
    const tz = branch.timeZone || "UTC";

    const period = String(req.query.period || "day").trim();
    const date = String(req.query.date || "").trim();         // ✅ specific business day anchor
    const dateFrom = String(req.query.dateFrom || "").trim(); // ✅ custom range
    const dateTo = String(req.query.dateTo || "").trim();

    const { fromLocal, toLocal, resolvedPeriod } = resolveBusinessDateRange({
      period,
      date,
      dateFrom,
      dateTo,
      tz,
    });

    const shiftFrom = String(req.query.shiftFrom || "").trim();
    const shiftTo = String(req.query.shiftTo || "").trim();
    const shiftFromMin = shiftFrom ? parseHHmm(shiftFrom) : null;
    const shiftToMin = shiftTo ? parseHHmm(shiftTo) : null;
    const wantShift = shiftFromMin !== null && shiftToMin !== null;

    // ✅ MATCH BY businessDayLocal snapshot (not placedAt midnight bounds)
    const baseMatch =
      fromLocal === toLocal
        ? { branchId, businessDayLocal: fromLocal }
        : { branchId, businessDayLocal: { $gte: fromLocal, $lte: toLocal } };

    const stages = [{ $match: baseMatch }];

    // Optional shift filter (still based on placedAt local clock)
    if (wantShift) {
      stages.push({
        $addFields: {
          __local: { $dateToParts: { date: "$placedAt", timezone: tz } },
        },
      });

      stages.push({
        $addFields: {
          __localMinutes: {
            $add: [{ $multiply: ["$__local.hour", 60] }, "$__local.minute"],
          },
        },
      });

      if (shiftFromMin <= shiftToMin) {
        stages.push({
          $match: {
            $expr: {
              $and: [
                { $gte: ["$__localMinutes", shiftFromMin] },
                { $lt: ["$__localMinutes", shiftToMin] },
              ],
            },
          },
        });
      } else {
        // wraps midnight
        stages.push({
          $match: {
            $expr: {
              $or: [
                { $gte: ["$__localMinutes", shiftFromMin] },
                { $lt: ["$__localMinutes", shiftToMin] },
              ],
            },
          },
        });
      }
    }

    stages.push({
      $facet: {
        kpis: [
          {
            $group: {
              _id: null,
              totalOrders: { $sum: 1 },
              grossSales: { $sum: { $ifNull: ["$pricing.grandTotal", 0] } },
              subtotal: { $sum: { $ifNull: ["$pricing.subtotal", 0] } },
              vatAmount: { $sum: { $ifNull: ["$pricing.vatAmount", 0] } },
              serviceChargeAmount: { $sum: { $ifNull: ["$pricing.serviceChargeAmount", 0] } },

              // ✅ operational window from snapshot
              minBusinessStartUTC: { $min: "$businessDayStartUTC" },
              maxBusinessEndUTC: { $max: "$businessDayEndUTC" },
            },
          },
          {
            $addFields: {
              avgOrderValue: {
                $cond: [
                  { $gt: ["$totalOrders", 0] },
                  { $divide: ["$grossSales", "$totalOrders"] },
                  0,
                ],
              },
            },
          },
        ],

        byStatus: [
          {
            $group: {
              _id: { $toUpper: { $ifNull: ["$status", "UNKNOWN"] } },
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
        ],

        // ✅ group by businessDayLocal (not by placedAt date)
        dailySeries: [
          {
            $group: {
              _id: "$businessDayLocal",
              orders: { $sum: 1 },
              sales: { $sum: { $ifNull: ["$pricing.grandTotal", 0] } },
            },
          },
          { $sort: { _id: 1 } },
        ],

        hourly: [
          {
            $group: {
              _id: {
                $dateToString: {
                  date: "$placedAt",
                  format: "%H",
                  timezone: tz,
                },
              },
              orders: { $sum: 1 },
              sales: { $sum: { $ifNull: ["$pricing.grandTotal", 0] } },
            },
          },
          { $sort: { _id: 1 } },
        ],

        topItems: [
          { $unwind: "$items" },
          {
            $group: {
              _id: "$items.itemId",
              nameEnglish: { $first: "$items.nameEnglish" },
              nameArabic: { $first: "$items.nameArabic" },
              qty: { $sum: { $ifNull: ["$items.quantity", 0] } },
              revenue: { $sum: { $ifNull: ["$items.lineTotal", 0] } },
            },
          },
          { $sort: { revenue: -1 } },
          { $limit: 10 },
        ],

        speed: [
          {
            $project: {
              placedAt: 1,
              readyAt: 1,
              servedAt: 1,
              prepMin: {
                $cond: [
                  { $and: [{ $ne: ["$readyAt", null] }, { $ne: ["$placedAt", null] }] },
                  { $divide: [{ $subtract: ["$readyAt", "$placedAt"] }, 60000] },
                  null,
                ],
              },
              serveMin: {
                $cond: [
                  { $and: [{ $ne: ["$servedAt", null] }, { $ne: ["$placedAt", null] }] },
                  { $divide: [{ $subtract: ["$servedAt", "$placedAt"] }, 60000] },
                  null,
                ],
              },
            },
          },
          {
            $group: {
              _id: null,
              avgPrepMin: { $avg: "$prepMin" },
              avgServeMin: { $avg: "$serveMin" },
              prepSamples: { $sum: { $cond: [{ $ne: ["$prepMin", null] }, 1, 0] } },
              serveSamples: { $sum: { $cond: [{ $ne: ["$serveMin", null] }, 1, 0] } },
            },
          },
        ],
      },
    });

    const [agg] = await Order.aggregate(stages).allowDiskUse(true);

    const k = (agg?.kpis && agg.kpis[0]) || {
      totalOrders: 0,
      grossSales: 0,
      subtotal: 0,
      vatAmount: 0,
      serviceChargeAmount: 0,
      avgOrderValue: 0,
      minBusinessStartUTC: null,
      maxBusinessEndUTC: null,
    };

    // If no orders exist (especially for day view), try to compute window from branch.openingHours
    let startUTC = k.minBusinessStartUTC || null;
    let endUTC = k.maxBusinessEndUTC || null;
    let windowLabel = null;

    if (!startUTC || !endUTC) {
      // Only meaningful for single-day queries
      if (fromLocal === toLocal) {
        const w = computeBusinessWindowForLocalYmd({
          ymd: fromLocal,
          tz,
          openingHours: branch.openingHours || {},
        });
        if (w) {
          startUTC = w.businessDayStartUTC;
          endUTC = w.businessDayEndUTC;
          windowLabel = w.businessWindowLabel;
        }
      }
    }

    const ordersStats = {
      totalOrders: Number(k.totalOrders || 0),
      grossSales: Number(k.grossSales || 0),
      subtotal: Number(k.subtotal || 0),
      vatAmount: Number(k.vatAmount || 0),
      serviceChargeAmount: Number(k.serviceChargeAmount || 0),
      avgOrderValue: Number(k.avgOrderValue || 0),

      byStatus: agg?.byStatus || [],
      dailySeries: agg?.dailySeries || [],
      hourly: agg?.hourly || [],
      topItems: agg?.topItems || [],
      speed: (agg?.speed && agg.speed[0]) || {
        avgPrepMin: null,
        avgServeMin: null,
        prepSamples: 0,
        serveSamples: 0,
      },
    };

    return res.json({
      message: "Dashboard summary",
      branchId,
      vendorId: branch.vendorId,

      currency: branch.currency || "BHD",
      timeZone: tz,

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

      // ✅ Updated period metadata: BUSINESS DATE RANGE + operational window (if available)
      period: {
        requested: period || "day",
        resolved: resolvedPeriod,
        fromLocal,
        toLocal,
        startUTC,
        endUTC,
        windowLabel,
        date,
        dateFrom,
        dateTo,
        shift: wantShift ? { shiftFrom, shiftTo } : null,
      },

      orders: ordersStats,
    });
  } catch (err) {
    console.error("getDashboardSummary error:", err);
    return res.status(500).json({
      code: "SERVER_ERROR",
      message: err?.message || "Unexpected error",
    });
  }
};

// import Branch from "../models/Branch.js";
// import Vendor from "../models/Vendor.js";
// import MenuItem from "../models/MenuItem.js";
// import Order from "../models/Order.js";

// // ---------------- same ownership helper ----------------
// async function userOwnsBranch(req, branch) {
//   const uid = req.user?.uid;
//   if (!uid || !branch) return false;

//   if (branch.userId === uid) return true;

//   const vendor = await Vendor.findOne({ vendorId: branch.vendorId }).lean();
//   if (vendor && vendor.userId === uid) return true;

//   return false;
// }

// // -----------------------------
// // Time helpers (IANA timezone safe without external libs)
// // -----------------------------
// function pad2(n) {
//   return String(n).padStart(2, "0");
// }

// function parseDateStrYYYYMMDD(dateStr) {
//   const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || "").trim());
//   if (!m) return null;
//   return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) };
// }

// function addDaysUTC(y, mo, d, deltaDays) {
//   const dt = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0)); // noon anchor
//   dt.setUTCDate(dt.getUTCDate() + deltaDays);
//   return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
// }

// /**
//  * Compute timezone offset minutes at given UTC date for a tz.
//  * Returns minutes to add to UTC to get local time. (e.g. Bahrain => +180)
//  */
// function tzOffsetMinutesAt(utcDate, tz) {
//   const fmt = new Intl.DateTimeFormat("en-CA", {
//     timeZone: tz,
//     year: "numeric",
//     month: "2-digit",
//     day: "2-digit",
//     hour: "2-digit",
//     minute: "2-digit",
//     second: "2-digit",
//     hour12: false,
//   });

//   const parts = fmt.formatToParts(utcDate);
//   const get = (type) => parts.find((p) => p.type === type)?.value;

//   const y = Number(get("year"));
//   const m = Number(get("month"));
//   const d = Number(get("day"));
//   const hh = Number(get("hour"));
//   const mm = Number(get("minute"));
//   const ss = Number(get("second"));

//   // Treat that wall-clock as UTC, compare to actual UTC => derive offset
//   const asUTC = Date.UTC(y, m - 1, d, hh, mm, ss);
//   const actualUTC = utcDate.getTime();
//   return Math.round((asUTC - actualUTC) / 60000);
// }

// /**
//  * Convert a local date-time in tz -> UTC Date
//  * local: {y,mo,d,hh,mm,ss}
//  */
// function zonedLocalToUtc({ y, mo, d, hh = 0, mm = 0, ss = 0 }, tz) {
//   const guess = new Date(Date.UTC(y, mo - 1, d, hh, mm, ss));
//   const off = tzOffsetMinutesAt(guess, tz);
//   // local = utc + off => utc = local - off
//   return new Date(guess.getTime() - off * 60000);
// }

// function resolvePeriodRange({ period, date, dateFrom, dateTo, tz }) {
//   // Custom range (inclusive by date)
//   const fromParsed = parseDateStrYYYYMMDD(dateFrom);
//   const toParsed = parseDateStrYYYYMMDD(dateTo);

//   if (fromParsed && toParsed) {
//     const a = `${fromParsed.y}${pad2(fromParsed.mo)}${pad2(fromParsed.d)}`;
//     const b = `${toParsed.y}${pad2(toParsed.mo)}${pad2(toParsed.d)}`;
//     const from = a <= b ? fromParsed : toParsed;
//     const to = a <= b ? toParsed : fromParsed;

//     const startUTC = zonedLocalToUtc({ ...from, hh: 0, mm: 0, ss: 0 }, tz);
//     const endNextDay = addDaysUTC(to.y, to.mo, to.d, 1);
//     const endUTC = zonedLocalToUtc({ ...endNextDay, hh: 0, mm: 0, ss: 0 }, tz);

//     return { startUTC, endUTC, resolvedPeriod: "custom" };
//   }

//   // Base date: today in tz if not provided
//   const base = parseDateStrYYYYMMDD(date) || (() => {
//     const now = new Date();
//     const fmt = new Intl.DateTimeFormat("en-CA", {
//       timeZone: tz,
//       year: "numeric",
//       month: "2-digit",
//       day: "2-digit",
//     });
//     const [Y, M, D] = fmt.format(now).split("-").map(Number);
//     return { y: Y, mo: M, d: D };
//   })();

//   const p = String(period || "day").toLowerCase();

//   if (p === "day") {
//     const startUTC = zonedLocalToUtc({ ...base, hh: 0, mm: 0, ss: 0 }, tz);
//     const next = addDaysUTC(base.y, base.mo, base.d, 1);
//     const endUTC = zonedLocalToUtc({ ...next, hh: 0, mm: 0, ss: 0 }, tz);
//     return { startUTC, endUTC, resolvedPeriod: "day" };
//   }

//   if (p === "week") {
//     const from = addDaysUTC(base.y, base.mo, base.d, -6);
//     const toNext = addDaysUTC(base.y, base.mo, base.d, 1);
//     const startUTC = zonedLocalToUtc({ ...from, hh: 0, mm: 0, ss: 0 }, tz);
//     const endUTC = zonedLocalToUtc({ ...toNext, hh: 0, mm: 0, ss: 0 }, tz);
//     return { startUTC, endUTC, resolvedPeriod: "week" };
//   }

//   if (p === "month") {
//     const from = addDaysUTC(base.y, base.mo, base.d, -29);
//     const toNext = addDaysUTC(base.y, base.mo, base.d, 1);
//     const startUTC = zonedLocalToUtc({ ...from, hh: 0, mm: 0, ss: 0 }, tz);
//     const endUTC = zonedLocalToUtc({ ...toNext, hh: 0, mm: 0, ss: 0 }, tz);
//     return { startUTC, endUTC, resolvedPeriod: "month" };
//   }

//   if (p === "year") {
//     const from = addDaysUTC(base.y, base.mo, base.d, -364);
//     const toNext = addDaysUTC(base.y, base.mo, base.d, 1);
//     const startUTC = zonedLocalToUtc({ ...from, hh: 0, mm: 0, ss: 0 }, tz);
//     const endUTC = zonedLocalToUtc({ ...toNext, hh: 0, mm: 0, ss: 0 }, tz);
//     return { startUTC, endUTC, resolvedPeriod: "year" };
//   }

//   // fallback day
//   const startUTC = zonedLocalToUtc({ ...base, hh: 0, mm: 0, ss: 0 }, tz);
//   const next = addDaysUTC(base.y, base.mo, base.d, 1);
//   const endUTC = zonedLocalToUtc({ ...next, hh: 0, mm: 0, ss: 0 }, tz);
//   return { startUTC, endUTC, resolvedPeriod: "day" };
// }

// function parseHHmm(s) {
//   const m = /^(\d{2}):(\d{2})$/.exec(String(s || "").trim());
//   if (!m) return null;
//   const hh = Number(m[1]);
//   const mm = Number(m[2]);
//   if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
//   return hh * 60 + mm;
// }

// // ---------------- GET /api/dashboard/summary?branchId=BR-000009 ----------------
// // Optional params:
// //  period=day|week|month|year|custom
// //  date=YYYY-MM-DD
// //  dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
// //  shiftFrom=HH:mm&shiftTo=HH:mm  (optional, wraps midnight supported)
// export const getDashboardSummary = async (req, res) => {
//   try {
//     const branchId = String(req.query.branchId || "").trim();
//     if (!branchId) {
//       return res
//         .status(400)
//         .json({ code: "BRANCH_ID_REQUIRED", message: "branchId is required" });
//     }

//     const branch = await Branch.findOne({ branchId }).lean(false);
//     if (!branch) {
//       return res
//         .status(404)
//         .json({ code: "BRANCH_NOT_FOUND", message: "Branch not found" });
//     }

//     if (!(await userOwnsBranch(req, branch))) {
//       return res
//         .status(403)
//         .json({ code: "FORBIDDEN", message: "You do not own this branch" });
//     }

//     // ----------------------------
//     // EXISTING MENU + ITEMS STATS (KEEP)
//     // ----------------------------
//     const enabledSections = (branch.menuSections || []).filter(
//       (s) => s && s.isEnabled === true
//     );

//     const totalSections = (branch.menuSections || []).length;
//     const enabledSectionsCount = enabledSections.length;
//     const enabledMenuTypesCount = enabledSectionsCount;

//     const filter = { branchId };

//     const [
//       totalItems,
//       activeItems,
//       availableItems,
//       featuredItems,
//       itemsWithImages,
//       itemsWithVideos,
//     ] = await Promise.all([
//       MenuItem.countDocuments(filter),
//       MenuItem.countDocuments({ ...filter, isActive: true }),
//       MenuItem.countDocuments({ ...filter, isAvailable: true }),
//       MenuItem.countDocuments({ ...filter, isFeatured: true }),
//       MenuItem.countDocuments({
//         ...filter,
//         imageUrl: { $exists: true, $ne: "" },
//       }),
//       MenuItem.countDocuments({
//         ...filter,
//         videoUrl: { $exists: true, $ne: "" },
//       }),
//     ]);

//     const lastMenuUpdate =
//       branch.menuStampAt ||
//       branch.menuUpdatedAt ||
//       branch.updatedAt ||
//       null;

//     // ----------------------------
//     // NEW: ORDER STATS
//     // ----------------------------
//     const tz = branch.timeZone || "UTC";

//     const period = String(req.query.period || "day").trim(); // day|week|month|year|custom
//     const date = String(req.query.date || "").trim();
//     const dateFrom = String(req.query.dateFrom || "").trim();
//     const dateTo = String(req.query.dateTo || "").trim();

//     const { startUTC, endUTC, resolvedPeriod } = resolvePeriodRange({
//       period,
//       date,
//       dateFrom,
//       dateTo,
//       tz,
//     });

//     const shiftFrom = String(req.query.shiftFrom || "").trim();
//     const shiftTo = String(req.query.shiftTo || "").trim();
//     const shiftFromMin = shiftFrom ? parseHHmm(shiftFrom) : null;
//     const shiftToMin = shiftTo ? parseHHmm(shiftTo) : null;
//     const wantShift = shiftFromMin !== null && shiftToMin !== null;

//     const baseMatch = {
//       branchId,
//       placedAt: { $gte: startUTC, $lt: endUTC },
//     };

//     const stages = [{ $match: baseMatch }];

//     if (wantShift) {
//       stages.push({
//         $addFields: {
//           __local: { $dateToParts: { date: "$placedAt", timezone: tz } },
//         },
//       });

//       stages.push({
//         $addFields: {
//           __localMinutes: {
//             $add: [{ $multiply: ["$__local.hour", 60] }, "$__local.minute"],
//           },
//         },
//       });

//       if (shiftFromMin <= shiftToMin) {
//         stages.push({
//           $match: {
//             $expr: {
//               $and: [
//                 { $gte: ["$__localMinutes", shiftFromMin] },
//                 { $lt: ["$__localMinutes", shiftToMin] },
//               ],
//             },
//           },
//         });
//       } else {
//         // wraps midnight
//         stages.push({
//           $match: {
//             $expr: {
//               $or: [
//                 { $gte: ["$__localMinutes", shiftFromMin] },
//                 { $lt: ["$__localMinutes", shiftToMin] },
//               ],
//             },
//           },
//         });
//       }
//     }

//     stages.push({
//       $facet: {
//         kpis: [
//           {
//             $group: {
//               _id: null,
//               totalOrders: { $sum: 1 },
//               grossSales: { $sum: { $ifNull: ["$pricing.grandTotal", 0] } },
//               subtotal: { $sum: { $ifNull: ["$pricing.subtotal", 0] } },
//               vatAmount: { $sum: { $ifNull: ["$pricing.vatAmount", 0] } },
//               serviceChargeAmount: { $sum: { $ifNull: ["$pricing.serviceChargeAmount", 0] } },
//             },
//           },
//           {
//             $addFields: {
//               avgOrderValue: {
//                 $cond: [
//                   { $gt: ["$totalOrders", 0] },
//                   { $divide: ["$grossSales", "$totalOrders"] },
//                   0,
//                 ],
//               },
//             },
//           },
//         ],

//         byStatus: [
//           {
//             $group: {
//               _id: { $toUpper: { $ifNull: ["$status", "UNKNOWN"] } },
//               count: { $sum: 1 },
//             },
//           },
//           { $sort: { count: -1 } },
//         ],

//         dailySeries: [
//           {
//             $group: {
//               _id: {
//                 $dateToString: {
//                   date: "$placedAt",
//                   format: "%Y-%m-%d",
//                   timezone: tz,
//                 },
//               },
//               orders: { $sum: 1 },
//               sales: { $sum: { $ifNull: ["$pricing.grandTotal", 0] } },
//             },
//           },
//           { $sort: { _id: 1 } },
//         ],

//         hourly: [
//           {
//             $group: {
//               _id: {
//                 $dateToString: {
//                   date: "$placedAt",
//                   format: "%H",
//                   timezone: tz,
//                 },
//               },
//               orders: { $sum: 1 },
//               sales: { $sum: { $ifNull: ["$pricing.grandTotal", 0] } },
//             },
//           },
//           { $sort: { _id: 1 } },
//         ],

//         topItems: [
//           { $unwind: "$items" },
//           {
//             $group: {
//               _id: "$items.itemId",
//               nameEnglish: { $first: "$items.nameEnglish" },
//               nameArabic: { $first: "$items.nameArabic" },
//               qty: { $sum: { $ifNull: ["$items.quantity", 0] } },
//               revenue: { $sum: { $ifNull: ["$items.lineTotal", 0] } },
//             },
//           },
//           { $sort: { revenue: -1 } },
//           { $limit: 10 },
//         ],

//         speed: [
//           {
//             $project: {
//               placedAt: 1,
//               readyAt: 1,
//               servedAt: 1,
//               prepMin: {
//                 $cond: [
//                   { $and: [{ $ne: ["$readyAt", null] }, { $ne: ["$placedAt", null] }] },
//                   { $divide: [{ $subtract: ["$readyAt", "$placedAt"] }, 60000] },
//                   null,
//                 ],
//               },
//               serveMin: {
//                 $cond: [
//                   { $and: [{ $ne: ["$servedAt", null] }, { $ne: ["$placedAt", null] }] },
//                   { $divide: [{ $subtract: ["$servedAt", "$placedAt"] }, 60000] },
//                   null,
//                 ],
//               },
//             },
//           },
//           {
//             $group: {
//               _id: null,
//               avgPrepMin: { $avg: "$prepMin" },
//               avgServeMin: { $avg: "$serveMin" },
//               prepSamples: { $sum: { $cond: [{ $ne: ["$prepMin", null] }, 1, 0] } },
//               serveSamples: { $sum: { $cond: [{ $ne: ["$serveMin", null] }, 1, 0] } },
//             },
//           },
//         ],
//       },
//     });

//     const [agg] = await Order.aggregate(stages).allowDiskUse(true);

//     const k = (agg?.kpis && agg.kpis[0]) || {
//       totalOrders: 0,
//       grossSales: 0,
//       subtotal: 0,
//       vatAmount: 0,
//       serviceChargeAmount: 0,
//       avgOrderValue: 0,
//     };

//     const ordersStats = {
//       totalOrders: Number(k.totalOrders || 0),
//       grossSales: Number(k.grossSales || 0),
//       subtotal: Number(k.subtotal || 0),
//       vatAmount: Number(k.vatAmount || 0),
//       serviceChargeAmount: Number(k.serviceChargeAmount || 0),
//       avgOrderValue: Number(k.avgOrderValue || 0),

//       byStatus: agg?.byStatus || [],
//       dailySeries: agg?.dailySeries || [],
//       hourly: agg?.hourly || [],
//       topItems: agg?.topItems || [],
//       speed: (agg?.speed && agg.speed[0]) || {
//         avgPrepMin: null,
//         avgServeMin: null,
//         prepSamples: 0,
//         serveSamples: 0,
//       },
//     };

//     // ----------------------------
//     // FINAL RESPONSE (Backwards compatible + new orders stats)
//     // ----------------------------
//     return res.json({
//       message: "Dashboard summary",
//       branchId,
//       vendorId: branch.vendorId,

//       currency: branch.currency || "BHD",
//       timeZone: tz,

//       menu: {
//         totalSections,
//         enabledSectionsCount,
//         enabledMenuTypesCount,
//         enabledSectionKeys: enabledSections.map((s) => s.key),
//       },

//       items: {
//         totalItems,
//         activeItems,
//         availableItems,
//         featuredItems,
//         itemsWithImages,
//         itemsWithVideos,
//       },

//       lastMenuUpdate,

//       // ✅ NEW
//       period: {
//         requested: period || "day",
//         resolved: resolvedPeriod,
//         startUTC,
//         endUTC,
//         date,
//         dateFrom,
//         dateTo,
//         shift: wantShift ? { shiftFrom, shiftTo } : null,
//       },

//       // ✅ NEW
//       orders: ordersStats,
//     });
//   } catch (err) {
//     console.error("getDashboardSummary error:", err);
//     return res.status(500).json({
//       code: "SERVER_ERROR",
//       message: err?.message || "Unexpected error",
//     });
//   }
// };



// import Branch from "../models/Branch.js";
// import Vendor from "../models/Vendor.js";
// import MenuItem from "../models/MenuItem.js";
// // If you have MenuType model and want counts from it, import it too:
// // import MenuType from "../models/MenuType.js";

// // ---------------- same ownership helper ----------------
// async function userOwnsBranch(req, branch) {
//   const uid = req.user?.uid;
//   if (!uid || !branch) return false;

//   if (branch.userId === uid) return true;

//   const vendor = await Vendor.findOne({ vendorId: branch.vendorId }).lean();
//   if (vendor && vendor.userId === uid) return true;

//   return false;
// }

// // ---------------- GET /api/dashboard/summary?branchId=BR-000009 ----------------
// export const getDashboardSummary = async (req, res) => {
//   try {
//     const branchId = String(req.query.branchId || "").trim();
//     if (!branchId) {
//       return res
//         .status(400)
//         .json({ code: "BRANCH_ID_REQUIRED", message: "branchId is required" });
//     }

//     const branch = await Branch.findOne({ branchId }).lean(false);
//     if (!branch) {
//       return res
//         .status(404)
//         .json({ code: "BRANCH_NOT_FOUND", message: "Branch not found" });
//     }

//     if (!(await userOwnsBranch(req, branch))) {
//       return res
//         .status(403)
//         .json({ code: "FORBIDDEN", message: "You do not own this branch" });
//     }

//     // ----- Menu sections enabled on branch -----
//     const enabledSections = (branch.menuSections || []).filter(
//       (s) => s && s.isEnabled === true
//     );

//     const totalSections = (branch.menuSections || []).length;
//     const enabledSectionsCount = enabledSections.length;

//     // If you treat "menuTypes enabled" == enabled sections (your current model),
//     // then this is the same value:
//     const enabledMenuTypesCount = enabledSectionsCount;

//     // ----- Items counts -----
//     const filter = { branchId };

//     const [
//       totalItems,
//       activeItems,
//       availableItems,
//       featuredItems,
//       itemsWithImages,
//       itemsWithVideos,
//     ] = await Promise.all([
//       MenuItem.countDocuments(filter),
//       MenuItem.countDocuments({ ...filter, isActive: true }),
//       MenuItem.countDocuments({ ...filter, isAvailable: true }),
//       MenuItem.countDocuments({ ...filter, isFeatured: true }),
//       MenuItem.countDocuments({
//         ...filter,
//         imageUrl: { $exists: true, $ne: "" },
//       }),
//       MenuItem.countDocuments({
//         ...filter,
//         videoUrl: { $exists: true, $ne: "" },
//       }),
//     ]);

//     // OPTIONAL: if your Branch schema stores a "menu stamp" / last change time
//     // (you call touchBranchMenuStampByBizId(branchId)), you may already have a field like:
//     // branch.menuStampAt, branch.menuUpdatedAt, branch.menuStamp, etc.
//     // Just return it if it exists:
//     const lastMenuUpdate =
//       branch.menuStampAt ||
//       branch.menuUpdatedAt ||
//       branch.updatedAt ||
//       null;

//     return res.json({
//       message: "Dashboard summary",
//       branchId,
//       vendorId: branch.vendorId,

//       menu: {
//         totalSections,
//         enabledSectionsCount,
//         enabledMenuTypesCount,
//         enabledSectionKeys: enabledSections.map((s) => s.key),
//       },

//       items: {
//         totalItems,
//         activeItems,
//         availableItems,
//         featuredItems,
//         itemsWithImages,
//         itemsWithVideos,
//       },

//       lastMenuUpdate,
//     });
//   } catch (err) {
//     console.error("getDashboardSummary error:", err);
//     return res.status(500).json({
//       code: "SERVER_ERROR",
//       message: err?.message || "Unexpected error",
//     });
//   }
// };
