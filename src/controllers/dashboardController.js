// // // // controllers/dashboardController.js
// // // controllers/dashboardController.js
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
// Time helpers (IANA timezone safe without external libs)
// -----------------------------
function pad2(n) {
  return String(n).padStart(2, "0");
}

function parseDateStrYYYYMMDD(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || "").trim());
  if (!m) return null;
  return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) };
}

// Convert Date -> "YYYY-MM-DD" in tz
function localYmd(date, tz) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "00";
  const d = parts.find((p) => p.type === "day")?.value ?? "00";
  return `${y}-${m}-${d}`;
}

// Date for a local "YYYY-MM-DD" + "HH:mm" in a tz, returned as a UTC Date
function dateFromLocalYmdHm(ymd, hm, tz) {
  const [Y, M, D] = ymd.split("-").map(Number);
  const [hh, mm] = hm.split(":").map(Number);

  const guess = new Date(Date.UTC(Y, M - 1, D, hh, mm, 0, 0));

  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts = fmt.formatToParts(guess);
  const yy = Number(parts.find((p) => p.type === "year")?.value);
  const mo = Number(parts.find((p) => p.type === "month")?.value);
  const da = Number(parts.find((p) => p.type === "day")?.value);
  const ho = Number(parts.find((p) => p.type === "hour")?.value);
  const mi = Number(parts.find((p) => p.type === "minute")?.value);
  const se = Number(parts.find((p) => p.type === "second")?.value);

  const tzAsUTC = Date.UTC(yy, mo - 1, da, ho, mi, se);
  const guessUTC = guess.getTime();
  const offsetMs = tzAsUTC - guessUTC;

  return new Date(guess.getTime() - offsetMs);
}

function dayKeyFromDateInTz(date, tz) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  }).format(date); // "Mon"..."Sun"
}

function parseHoursRange(str) {
  // "HH:mm-HH:mm"
  if (!str || typeof str !== "string") return null;
  const s = str.trim();
  const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  return { open: `${m[1]}:${m[2]}`, close: `${m[3]}:${m[4]}` };
}

function mins(hm) {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Compute operational window for a "business day" based on openingHours for that weekday.
 * If close <= open => crosses midnight to next day.
 *
 * Business day is the day of the OPEN time.
 */
function computeBusinessWindowForLocalDay({ businessDayLocal, tz, openingHours }) {
  const baseMidnightUTC = dateFromLocalYmdHm(businessDayLocal, "00:00", tz);
  const dayKey = dayKeyFromDateInTz(baseMidnightUTC, tz);

  const rangeStr = openingHours?.[dayKey];
  const parsed = parseHoursRange(rangeStr);

  if (!parsed) {
    // fallback: calendar day
    const startUTC = dateFromLocalYmdHm(businessDayLocal, "00:00", tz);
    const endUTC = new Date(startUTC.getTime() + 24 * 3600 * 1000);
    return {
      businessDayLocal,
      startUTC,
      endUTC,
      windowLabel: `Calendar ${businessDayLocal}`,
    };
  }

  const startUTC = dateFromLocalYmdHm(businessDayLocal, parsed.open, tz);

  const openMin = mins(parsed.open);
  const closeMin = mins(parsed.close);

  const closeLocalDay = closeMin <= openMin
    ? localYmd(new Date(baseMidnightUTC.getTime() + 24 * 3600 * 1000), tz) // next local day
    : businessDayLocal;

  const endUTC = dateFromLocalYmdHm(closeLocalDay, parsed.close, tz);

  return {
    businessDayLocal,
    startUTC,
    endUTC,
    windowLabel: `${dayKey} ${parsed.open}-${parsed.close}`,
  };
}

/**
 * For "now", determine which business window contains it:
 * - Try today's business day
 * - Try yesterday's business day (to catch after-midnight)
 */
function resolveBusinessWindowForNow({ tz, openingHours }) {
  const now = new Date();
  const todayLocal = localYmd(now, tz);

  const todayWin = computeBusinessWindowForLocalDay({
    businessDayLocal: todayLocal,
    tz,
    openingHours,
  });

  const yBase = new Date(dateFromLocalYmdHm(todayLocal, "00:00", tz).getTime() - 24 * 3600 * 1000);
  const yLocal = localYmd(yBase, tz);

  const yWin = computeBusinessWindowForLocalDay({
    businessDayLocal: yLocal,
    tz,
    openingHours,
  });

  if (now >= todayWin.startUTC && now < todayWin.endUTC) return todayWin;
  if (now >= yWin.startUTC && now < yWin.endUTC) return yWin;

  // fallback
  return todayWin;
}

// For range periods we’ll filter by businessDayLocal string comparison (YYYY-MM-DD sorts correctly)
function resolveBusinessDayRange({ period, date, dateFrom, dateTo, tz }) {
  // custom
  const fromP = parseDateStrYYYYMMDD(dateFrom);
  const toP = parseDateStrYYYYMMDD(dateTo);
  if (fromP && toP) {
    const a = `${fromP.y}${pad2(fromP.mo)}${pad2(fromP.d)}`;
    const b = `${toP.y}${pad2(toP.mo)}${pad2(toP.d)}`;
    const from = a <= b ? `${fromP.y}-${pad2(fromP.mo)}-${pad2(fromP.d)}` : `${toP.y}-${pad2(toP.mo)}-${pad2(toP.d)}`;
    const to = a <= b ? `${toP.y}-${pad2(toP.mo)}-${pad2(toP.d)}` : `${fromP.y}-${pad2(fromP.mo)}-${pad2(fromP.d)}`;
    return { fromLocal: from, toLocal: to, resolvedPeriod: "custom" };
  }

  // base date in tz (today if missing)
  const base = parseDateStrYYYYMMDD(date) || (() => {
    const now = new Date();
    const [Y, M, D] = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now).split("-").map(Number);
    return { y: Y, mo: M, d: D };
  })();

  const baseLocal = `${base.y}-${pad2(base.mo)}-${pad2(base.d)}`;
  const p = String(period || "day").toLowerCase();

  // small utility: subtract N days by using UTC noon anchor safely
  function addDaysLocal(localYmdStr, delta) {
    const dt = dateFromLocalYmdHm(localYmdStr, "12:00", tz); // noon anchor
    dt.setUTCDate(dt.getUTCDate() + delta);
    return localYmd(dt, tz);
  }

  if (p === "week") {
    return { fromLocal: addDaysLocal(baseLocal, -6), toLocal: baseLocal, resolvedPeriod: "week" };
  }
  if (p === "month") {
    return { fromLocal: addDaysLocal(baseLocal, -29), toLocal: baseLocal, resolvedPeriod: "month" };
  }
  if (p === "year") {
    return { fromLocal: addDaysLocal(baseLocal, -364), toLocal: baseLocal, resolvedPeriod: "year" };
  }

  // fallback day
  return { fromLocal: baseLocal, toLocal: baseLocal, resolvedPeriod: "day" };
}

// ---------------- GET /api/dashboard/summary?branchId=BR-000009 ----------------
export const getDashboardSummary = async (req, res) => {
  try {
    const branchId = String(req.query.branchId || "").trim();
    if (!branchId) {
      return res.status(400).json({ code: "BRANCH_ID_REQUIRED", message: "branchId is required" });
    }

    const branch = await Branch.findOne({ branchId }).lean(false);
    if (!branch) {
      return res.status(404).json({ code: "BRANCH_NOT_FOUND", message: "Branch not found" });
    }

    if (!(await userOwnsBranch(req, branch))) {
      return res.status(403).json({ code: "FORBIDDEN", message: "You do not own this branch" });
    }

    // ----------------------------
    // EXISTING MENU + ITEMS STATS (KEEP)
    // ----------------------------
    const enabledSections = (branch.menuSections || []).filter((s) => s && s.isEnabled === true);
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
      MenuItem.countDocuments({ ...filter, imageUrl: { $exists: true, $ne: "" } }),
      MenuItem.countDocuments({ ...filter, videoUrl: { $exists: true, $ne: "" } }),
    ]);

    const lastMenuUpdate = branch.menuStampAt || branch.menuUpdatedAt || branch.updatedAt || null;

    // ----------------------------
    // ✅ ORDERS (OPERATIONAL DAY / BUSINESS DAY)
    // ----------------------------
    const tz = branch.timeZone || "UTC";
    const openingHours = (branch.openingHours && typeof branch.openingHours === "object")
      ? branch.openingHours
      : {};

    const periodReq = String(req.query.period || "day").trim().toLowerCase();
    const date = String(req.query.date || "").trim();
    const dateFrom = String(req.query.dateFrom || "").trim();
    const dateTo = String(req.query.dateTo || "").trim();

    let resolvedPeriod = periodReq;

    // ✅ day window
    let dayWindow = null;

    if (periodReq === "day") {
      if (date) {
        // explicit business day
        dayWindow = computeBusinessWindowForLocalDay({
          businessDayLocal: date,
          tz,
          openingHours,
        });
      } else {
        // ✅ IMPORTANT: "today" means "current operational day"
        dayWindow = resolveBusinessWindowForNow({ tz, openingHours });
      }
      resolvedPeriod = "day";
    }

    // ✅ range filters by businessDayLocal strings
    let fromLocal = "";
    let toLocal = "";

    if (resolvedPeriod === "day") {
      fromLocal = dayWindow.businessDayLocal;
      toLocal = dayWindow.businessDayLocal;
    } else {
      const r = resolveBusinessDayRange({
        period: periodReq,
        date,
        dateFrom,
        dateTo,
        tz,
      });
      fromLocal = r.fromLocal;
      toLocal = r.toLocal;
      resolvedPeriod = r.resolvedPeriod;
    }

    const baseMatch = {
      branchId,
      businessDayLocal: resolvedPeriod === "day"
        ? dayWindow.businessDayLocal
        : { $gte: fromLocal, $lte: toLocal },
    };

    const stages = [{ $match: baseMatch }];

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

        // ✅ group by businessDayLocal directly (NOT calendar placedAt)
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

        // ✅ hourly from placedAt (real order time), but only within matched business days
        hourly: [
          {
            $group: {
              _id: {
                $dateToString: { date: "$placedAt", format: "%H", timezone: tz },
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
    };

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

    // For response window details
    const startUTC = (resolvedPeriod === "day") ? dayWindow.startUTC : null;
    const endUTC = (resolvedPeriod === "day") ? dayWindow.endUTC : null;
    const windowLabel = (resolvedPeriod === "day") ? dayWindow.windowLabel : null;

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

      period: {
        requested: periodReq || "day",
        resolved: resolvedPeriod,
        // ✅ business date(s)
        fromLocal,
        toLocal,
        // ✅ only for day we expose operational window
        startUTC,
        endUTC,
        windowLabel,
        // keep old keys for compatibility if you want:
        date,
        dateFrom,
        dateTo,
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

// // controllers/dashboardController.js
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
// // Helpers
// // -----------------------------
// function pad2(n) {
//   return String(n).padStart(2, "0");
// }

// function parseDateStrYYYYMMDD(dateStr) {
//   const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || "").trim());
//   if (!m) return null;
//   return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) };
// }

// function ymdFromParts({ y, mo, d }) {
//   return `${y}-${pad2(mo)}-${pad2(d)}`;
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

// /** Today in tz as "YYYY-MM-DD" */
// function todayLocalYmd(tz) {
//   const now = new Date();
//   const fmt = new Intl.DateTimeFormat("en-CA", {
//     timeZone: tz,
//     year: "numeric",
//     month: "2-digit",
//     day: "2-digit",
//   });
//   return fmt.format(now); // "YYYY-MM-DD"
// }

// /**
//  * Resolve BUSINESS DATE RANGE using businessDayLocal strings.
//  *
//  * Supported:
//  * - period=day|week|month|year
//  * - date=YYYY-MM-DD (anchor/end date)
//  * - dateFrom/dateTo for custom (inclusive)
//  */
// function resolveBusinessDateRange({ period, date, dateFrom, dateTo, tz }) {
//   const fromParsed = parseDateStrYYYYMMDD(dateFrom);
//   const toParsed = parseDateStrYYYYMMDD(dateTo);

//   if (fromParsed && toParsed) {
//     const a = ymdFromParts(fromParsed);
//     const b = ymdFromParts(toParsed);
//     const fromLocal = a <= b ? a : b;
//     const toLocal = a <= b ? b : a;
//     return { fromLocal, toLocal, resolvedPeriod: "custom" };
//   }

//   const baseYmd = parseDateStrYYYYMMDD(date) ? date : todayLocalYmd(tz);
//   const baseParsed = parseDateStrYYYYMMDD(baseYmd);
//   const p = String(period || "day").toLowerCase();

//   if (!baseParsed) {
//     const t = todayLocalYmd(tz);
//     return { fromLocal: t, toLocal: t, resolvedPeriod: "day" };
//   }

//   if (p === "day") {
//     return { fromLocal: baseYmd, toLocal: baseYmd, resolvedPeriod: "day" };
//   }

//   if (p === "week") {
//     const from = addDaysUTC(baseParsed.y, baseParsed.mo, baseParsed.d, -6);
//     return { fromLocal: ymdFromParts(from), toLocal: baseYmd, resolvedPeriod: "week" };
//   }

//   if (p === "month") {
//     const from = addDaysUTC(baseParsed.y, baseParsed.mo, baseParsed.d, -29);
//     return { fromLocal: ymdFromParts(from), toLocal: baseYmd, resolvedPeriod: "month" };
//   }

//   if (p === "year") {
//     const from = addDaysUTC(baseParsed.y, baseParsed.mo, baseParsed.d, -364);
//     return { fromLocal: ymdFromParts(from), toLocal: baseYmd, resolvedPeriod: "year" };
//   }

//   // fallback day
//   return { fromLocal: baseYmd, toLocal: baseYmd, resolvedPeriod: "day" };
// }

// // ---- optional: compute an operational window if there are ZERO orders (day view)
// // uses branch.openingHours["Mon"] = "09:00-01:00" style
// function parseHoursRange(str) {
//   if (!str || typeof str !== "string") return null;
//   const s = str.trim();
//   const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(s);
//   if (!m) return null;
//   return {
//     openH: Number(m[1]),
//     openM: Number(m[2]),
//     closeH: Number(m[3]),
//     closeM: Number(m[4]),
//     openStr: `${m[1]}:${m[2]}`,
//     closeStr: `${m[3]}:${m[4]}`,
//   };
// }
// function minsFromHM(h, m) {
//   return h * 60 + m;
// }
// function weekdayKeyForLocalYmd(ymd, tz) {
//   const p = parseDateStrYYYYMMDD(ymd);
//   if (!p) return null;
//   const localMidUTC = zonedLocalToUtc({ ...p, hh: 0, mm: 0, ss: 0 }, tz);
//   return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(localMidUTC);
// }
// function computeBusinessWindowForLocalYmd({ ymd, tz, openingHours }) {
//   const dayKey = weekdayKeyForLocalYmd(ymd, tz); // "Mon"... "Sun"
//   if (!dayKey) return null;

//   const rangeStr = openingHours?.[dayKey];
//   const parsed = parseHoursRange(rangeStr);
//   if (!parsed) return null;

//   const base = parseDateStrYYYYMMDD(ymd);
//   if (!base) return null;

//   const startUTC = zonedLocalToUtc(
//     { ...base, hh: parsed.openH, mm: parsed.openM, ss: 0 },
//     tz
//   );

//   const openMin = minsFromHM(parsed.openH, parsed.openM);
//   const closeMin = minsFromHM(parsed.closeH, parsed.closeM);

//   const closeDate = (closeMin <= openMin)
//     ? addDaysUTC(base.y, base.mo, base.d, 1) // next local day
//     : base;

//   const endUTC = zonedLocalToUtc(
//     { ...closeDate, hh: parsed.closeH, mm: parsed.closeM, ss: 0 },
//     tz
//   );

//   return {
//     businessDayLocal: ymd,
//     businessDayStartUTC: startUTC,
//     businessDayEndUTC: endUTC,
//     businessWindowLabel: `${dayKey} ${parsed.openStr}-${parsed.closeStr}`,
//   };
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
//     // ORDER STATS (BUSINESS DAY BASED)
//     // ----------------------------
//     const tz = branch.timeZone || "UTC";

//     const period = String(req.query.period || "day").trim();
//     const date = String(req.query.date || "").trim();         // ✅ specific business day anchor
//     const dateFrom = String(req.query.dateFrom || "").trim(); // ✅ custom range
//     const dateTo = String(req.query.dateTo || "").trim();

//     const { fromLocal, toLocal, resolvedPeriod } = resolveBusinessDateRange({
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

//     // ✅ MATCH BY businessDayLocal snapshot (not placedAt midnight bounds)
//     const baseMatch =
//       fromLocal === toLocal
//         ? { branchId, businessDayLocal: fromLocal }
//         : { branchId, businessDayLocal: { $gte: fromLocal, $lte: toLocal } };

//     const stages = [{ $match: baseMatch }];

//     // Optional shift filter (still based on placedAt local clock)
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

//               // ✅ operational window from snapshot
//               minBusinessStartUTC: { $min: "$businessDayStartUTC" },
//               maxBusinessEndUTC: { $max: "$businessDayEndUTC" },
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

//         // ✅ group by businessDayLocal (not by placedAt date)
//         dailySeries: [
//           {
//             $group: {
//               _id: "$businessDayLocal",
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
//       minBusinessStartUTC: null,
//       maxBusinessEndUTC: null,
//     };

//     // If no orders exist (especially for day view), try to compute window from branch.openingHours
//     let startUTC = k.minBusinessStartUTC || null;
//     let endUTC = k.maxBusinessEndUTC || null;
//     let windowLabel = null;

//     if (!startUTC || !endUTC) {
//       // Only meaningful for single-day queries
//       if (fromLocal === toLocal) {
//         const w = computeBusinessWindowForLocalYmd({
//           ymd: fromLocal,
//           tz,
//           openingHours: branch.openingHours || {},
//         });
//         if (w) {
//           startUTC = w.businessDayStartUTC;
//           endUTC = w.businessDayEndUTC;
//           windowLabel = w.businessWindowLabel;
//         }
//       }
//     }

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

//       // ✅ Updated period metadata: BUSINESS DATE RANGE + operational window (if available)
//       period: {
//         requested: period || "day",
//         resolved: resolvedPeriod,
//         fromLocal,
//         toLocal,
//         startUTC,
//         endUTC,
//         windowLabel,
//         date,
//         dateFrom,
//         dateTo,
//         shift: wantShift ? { shiftFrom, shiftTo } : null,
//       },

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
