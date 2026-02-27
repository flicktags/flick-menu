// src/controllers/orderController.js
import mongoose from "mongoose";
import Branch from "../models/Branch.js";
import Order from "../models/Order.js";
import MenuItem from "../models/MenuItem.js";
import crypto from "crypto";
import { nextSeqByKey } from "../models/Counter.js";
import { publishOrderFanout } from "../realtime/ablyPublisher.js";

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
    return fromY <= toY
      ? { fromYmd: fromY, toYmd: toY, period: "custom" }
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

function pad2(n) {
  return String(n).padStart(2, "0");
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
// Uses Intl “timeZone” with a safe technique:
// build UTC guess, then compute tz offset by formatting.
function dateFromLocalYmdHm(ymd, hm, tz) {
  const [Y, M, D] = ymd.split("-").map(Number);
  const [hh, mm] = hm.split(":").map(Number);
  // start with a UTC guess
  const guess = new Date(Date.UTC(Y, M - 1, D, hh, mm, 0, 0));

  // get what the guess looks like in that tz
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

  // This is the tz-local time of "guess". We want it to equal the target local time.
  const tzAsUTC = Date.UTC(yy, mo - 1, da, ho, mi, se);
  const guessUTC = guess.getTime();
  const offsetMs = tzAsUTC - guessUTC;

  // Adjust guess by removing offset
  return new Date(guess.getTime() - offsetMs);
}

function dayKeyFromDateInTz(date, tz) {
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  }).format(date); // "Mon"..."Sun"
  return wd;
}

function parseHoursRange(str) {
  // expects "HH:mm-HH:mm"
  if (!str || typeof str !== "string") return null;
  const s = str.trim();
  const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const open = `${m[1]}:${m[2]}`;
  const close = `${m[3]}:${m[4]}`;
  return { open, close };
}

function mins(hm) {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

function readPlatformFeeFromTaxes(taxes) {
  const paidByCustomer = taxes?.platformFeePaidByCustomer === true;
  const showPlatformFee = taxes?.showPlatformFee !== false; // default true

  // stored as FILS (integer) e.g. 80
  const feeFilsRaw = taxes?.platformFeePerOrder;
  const feeFils = Number.isFinite(Number(feeFilsRaw))
    ? Math.max(0, Number(feeFilsRaw))
    : 0;

  // convert to BHD for pricing math
  const feeBhd = feeFils / 1000;

  // apply only when paidByCustomer
  const appliedBhd = paidByCustomer ? feeBhd : 0;

  return {
    platformFeePerOrderFils: feeFils,
    platformFeePerOrderBhd: feeBhd,
    platformFeePaidByCustomer: paidByCustomer,
    showPlatformFee,
    platformFeeAppliedBhd: appliedBhd,
  };
}

/**
 * Compute operational window for a "business day" based on openingHours for that weekday.
 * If close <= open => crosses midnight to next day.
 *
 * IMPORTANT:
 * - We define "business day" as the day of the OPEN time.
 * - Orders after midnight but before close belong to previous business day.
 */
function computeBusinessWindowForDate({ baseDate, tz, openingHours }) {
  const dayKey = dayKeyFromDateInTz(baseDate, tz); // "Fri" etc
  const rangeStr = openingHours?.[dayKey];
  const parsed = parseHoursRange(rangeStr);
  if (!parsed) return null;

  const ymd = localYmd(baseDate, tz);
  const startUTC = dateFromLocalYmdHm(ymd, parsed.open, tz);

  // close date might be same day or next day
  const openMin = mins(parsed.open);
  const closeMin = mins(parsed.close);
  const closeYmd =
    closeMin <= openMin
      ? localYmd(new Date(startUTC.getTime() + 24 * 3600 * 1000), tz) // next local day
      : ymd;

  const endUTC = dateFromLocalYmdHm(closeYmd, parsed.close, tz);

  return {
    businessDayLocal: ymd,
    businessDayStartUTC: startUTC,
    businessDayEndUTC: endUTC,
    businessWindowLabel: `${dayKey} ${parsed.open}-${parsed.close}`,
  };
}

/**
 * For a given order time, figure out which business day it belongs to:
 * - Try today's window (by OPEN day)
 * - Also try yesterday's window (to catch after-midnight)
 */
function resolveBusinessWindowForOrder({ orderDateUTC, tz, openingHours }) {
  // base date = local date of order time
  const localY = localYmd(orderDateUTC, tz);

  // create a Date representing localY midnight in tz (as UTC)
  const localMidnightUTC = dateFromLocalYmdHm(localY, "00:00", tz);

  const todayWindow = computeBusinessWindowForDate({
    baseDate: localMidnightUTC,
    tz,
    openingHours,
  });

  // yesterday base date
  const yesterdayBase = new Date(localMidnightUTC.getTime() - 24 * 3600 * 1000);
  const yWindow = computeBusinessWindowForDate({
    baseDate: yesterdayBase,
    tz,
    openingHours,
  });

  // pick the window that contains the order time
  if (
    todayWindow &&
    orderDateUTC >= todayWindow.businessDayStartUTC &&
    orderDateUTC < todayWindow.businessDayEndUTC
  ) {
    return todayWindow;
  }

  if (
    yWindow &&
    orderDateUTC >= yWindow.businessDayStartUTC &&
    orderDateUTC < yWindow.businessDayEndUTC
  ) {
    return yWindow;
  }

  // fallback: calendar day bounds
  const start = dateFromLocalYmdHm(localY, "00:00", tz);
  const end = new Date(start.getTime() + 24 * 3600 * 1000);

  return {
    businessDayLocal: localY,
    businessDayStartUTC: start,
    businessDayEndUTC: end,
    businessWindowLabel: `Calendar ${localY}`,
  };
}

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
    const taxes =
      branch.taxes && typeof branch.taxes === "object" ? branch.taxes : {};
    const vatPercent = Number(taxes.vatPercentage ?? 0) || 0;
    const serviceChargePercent =
      Number(taxes.serviceChargePercentage ?? 0) || 0;
    const isVatInclusive = taxes.isVatInclusive === true;

    // ✅ platform fee settings (stored in FILS in branch.taxes)
    const showPlatformFee = taxes.showPlatformFee !== false; // default true
    const platformFeePaidByCustomer = taxes.platformFeePaidByCustomer === true; // default false
    const platformFeePerOrderFilsRaw = taxes.platformFeePerOrder ?? 0;
    const platformFeePerOrderFils = Number.isFinite(
      Number(platformFeePerOrderFilsRaw),
    )
      ? Math.max(0, Number(platformFeePerOrderFilsRaw))
      : 0;
    const platformFeePerOrderBhd = platformFeePerOrderFils / 1000; // ✅ FILS -> BHD

    const vendorId = branch.vendorId;
    const tz = branch.timeZone || "UTC";

    // ✅ SINGLE server timestamp for this order creation
    const orderInstant = new Date();

    // ✅ use the same instant for date parts
    const { y, m, d, ymd } = tzPartsOf(orderInstant, tz);

    // ✅ snapshot business/operational day window based on opening hours
    const bizWindow = resolveBusinessWindowForOrder({
      orderDateUTC: orderInstant,
      tz,
      openingHours: branch.openingHours || {},
    });

    const round3 = (n) =>
      Math.round((Number(n || 0) + Number.EPSILON) * 1000) / 1000;

    // --------------------------------------
    // 1) Build list of Mongo ObjectIds
    // --------------------------------------
    const rawIds = [
      ...new Set(
        items
          .map((x) => String(x?.itemId || x?.id || "").trim())
          .filter(Boolean),
      ),
    ];
    if (rawIds.length === 0)
      return res
        .status(400)
        .json({ error: "Invalid items payload (no itemId)" });

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
      const validUntil = discount.validUntil
        ? new Date(discount.validUntil)
        : null;

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
        const sizeLabel = String(
          reqIt?.size?.label || reqIt?.sizeLabel || "",
        ).trim();
        if (!sizeLabel) {
          return res
            .status(400)
            .json({ error: "Missing size for sized item", itemId: mongoId });
        }
        const sizes = Array.isArray(dbIt.sizes) ? dbIt.sizes : [];
        const matched = sizes.find(
          (s) => String(s?.label || "").trim() === sizeLabel,
        );
        if (!matched) {
          return res.status(400).json({
            error: "Invalid size selected",
            itemId: mongoId,
            sizeLabel,
          });
        }
        basePrice = Number(matched.price ?? 0) || 0;
        sizeObj = { label: sizeLabel, price: round3(basePrice) };
      } else {
        const offered =
          dbIt.offeredPrice !== undefined ? Number(dbIt.offeredPrice) || 0 : 0;
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
        const groupLabel = String(
          a?.groupLabel || a?.group || a?.addonGroup || "",
        ).trim();
        const optionLabel = String(a?.optionLabel || a?.label || "").trim();
        if (!optionLabel) {
          return res.status(400).json({
            error: "Invalid addon (missing option label)",
            itemId: mongoId,
          });
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
        let group = null;

        if (groupKey !== "__default__") {
          group = addonGroups.find(
            (g) =>
              String(g?.label || "")
                .trim()
                .toLowerCase() === groupKey.trim().toLowerCase(),
          );
          if (!group) {
            return res.status(400).json({
              error: "Invalid addon group",
              itemId: mongoId,
              groupLabel: groupKey,
            });
          }
        }

        if (group) {
          const min = Number(group.min ?? 0) || 0;
          const max = Number(group.max ?? 1) || 1;

          if (optionLabels.length < min) {
            return res.status(400).json({
              error: "Addon group below min",
              itemId: mongoId,
              groupLabel: groupKey,
              min,
            });
          }
          if (optionLabels.length > max) {
            return res.status(400).json({
              error: "Addon group above max",
              itemId: mongoId,
              groupLabel: groupKey,
              max,
            });
          }
        }

        const allowedOptions = group
          ? Array.isArray(group.options)
            ? group.options
            : []
          : addonGroups.flatMap((g) =>
              Array.isArray(g?.options) ? g.options : [],
            );

        for (const optLabel of optionLabels) {
          const opt = allowedOptions.find(
            (o) =>
              String(o?.label || "")
                .trim()
                .toLowerCase() === optLabel.trim().toLowerCase(),
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
          const key = String(g.label || "")
            .trim()
            .toLowerCase();
          const selectedCount = (
            selectionsByGroup.get(g.label) ||
            selectionsByGroup.get(key) ||
            []
          ).length;

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
      const stationKey = String(dbIt.kdsStationKey || "MAIN")
        .trim()
        .toUpperCase();

      orderItems.push({
        itemId: mongoId,
        nameEnglish: dbIt.nameEnglish || "",
        nameArabic: dbIt.nameArabic || "",
        imageUrl: dbIt.imageUrl || "",
        kdsStationKey: stationKey, // ✅ snapshot per line
        isSizedBased: dbIt.isSizedBased === true,
        size: sizeObj,
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

    // ✅ Platform Fee (convert FILS -> BHD and include ONLY if paidByCustomer=true)
    const platformFee = platformFeePaidByCustomer
      ? round3(platformFeePerOrderBhd)
      : 0;

    grandTotal = round3(grandTotal + platformFee);

    const pricing = {
      subtotal: round3(subtotal),
      serviceChargePercent: round3(serviceChargePercent),
      serviceChargeAmount,
      vatPercent: round3(vatPercent),
      vatAmount,
      grandTotal,
      isVatInclusive,
      subtotalExVat,

      // ✅ platform fee fields
      platformFee, // BHD
      platformFeePaidByCustomer,
      showPlatformFee,
      platformFeePerOrderFils: Math.round(platformFeePerOrderFils), // for UI/audit
    };

    let parsedClientCreatedAt = null;
    if (clientCreatedAt) {
      const dt = new Date(clientCreatedAt);
      if (!isNaN(dt.getTime())) {
        parsedClientCreatedAt = dt;
      }
    }

    let parsedOffset = null;
    if (clientTzOffsetMinutes !== undefined && clientTzOffsetMinutes !== null) {
      const off = Number(clientTzOffsetMinutes);
      if (!Number.isNaN(off) && off >= -840 && off <= 840) {
        parsedOffset = off;
      }
    }

    const publicToken = crypto.randomBytes(16).toString("hex");

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
      publicToken,
      clientCreatedAt: parsedClientCreatedAt,
      clientTzOffsetMinutes: parsedOffset,

      // ✅ keep your behavior (server time), but use the SAME instant
      placedAt: orderInstant,

      // ✅ snapshot operational window in the order document
      businessDayLocal: bizWindow.businessDayLocal,
      businessDayStartUTC: bizWindow.businessDayStartUTC,
      businessDayEndUTC: bizWindow.businessDayEndUTC,
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
        await publishOrderFanout({
          branchId: created.branchId,
          eventName: "order.created",
          payload: {
            type: "order.created",
            branchId: created.branchId,
            orderId: String(created._id),
            tokenNumber: created.tokenNumber ?? null,
            revision: created.revision ?? 0,
            status: created.status,
          },
          items: created.items || [],
        });
        return res.status(201).json({
          message: "Order placed",
          order: {
            id: String(created._id),
            orderNumber: created.orderNumber,
            tokenNumber: created.tokenNumber,
            publicToken: created.publicToken,
            vendorId: created.vendorId,
            branchId: created.branchId,
            currency: created.currency,
            status: created.status,
            qr: created.qr,
            customer: created.customer,
            items: created.items,

            // ✅ now includes platformFee + flags + updated grandTotal
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

// export const createOrder = async (req, res) => {
//   try {
//     const {
//       branch: branchCode,
//       qr,
//       currency,
//       customer,
//       items,
//       remarks,
//       source = "customer_view",
//       clientCreatedAt,
//       clientTzOffsetMinutes,
//     } = req.body || {};

//     if (!branchCode) return res.status(400).json({ error: "Missing branch" });
//     if (!Array.isArray(items) || items.length === 0) {
//       return res.status(400).json({ error: "No items" });
//     }

//     const branch = await Branch.findOne({ branchId: branchCode }).lean();
//     if (!branch) return res.status(404).json({ error: "Branch not found" });

//     // ✅ authoritative tax settings from branch
//     const taxes =
//       branch.taxes && typeof branch.taxes === "object" ? branch.taxes : {};
//     const vatPercent = Number(taxes.vatPercentage ?? 0) || 0;
//     const serviceChargePercent =
//       Number(taxes.serviceChargePercentage ?? 0) || 0;
//     const isVatInclusive = taxes.isVatInclusive === true;

//     const vendorId = branch.vendorId;
//     const tz = branch.timeZone || "UTC";

//     // ✅ SINGLE server timestamp for this order creation
//     const orderInstant = new Date();

//     // ✅ use the same instant for date parts
//     const { y, m, d, ymd } = tzPartsOf(orderInstant, tz);

//     // ✅ NEW: snapshot business/operational day window based on opening hours
//     const bizWindow = resolveBusinessWindowForOrder({
//       orderDateUTC: orderInstant,
//       tz,
//       openingHours: branch.openingHours || {},
//     });

//     const round3 = (n) =>
//       Math.round((Number(n || 0) + Number.EPSILON) * 1000) / 1000;

//     // --------------------------------------
//     // 1) Build list of Mongo ObjectIds
//     // --------------------------------------
//     const rawIds = [
//       ...new Set(
//         items
//           .map((x) => String(x?.itemId || x?.id || "").trim())
//           .filter(Boolean),
//       ),
//     ];
//     if (rawIds.length === 0)
//       return res
//         .status(400)
//         .json({ error: "Invalid items payload (no itemId)" });

//     const objectIds = [];
//     for (const id of rawIds) {
//       if (!mongoose.Types.ObjectId.isValid(id)) {
//         return res.status(400).json({ error: "Invalid itemId", itemId: id });
//       }
//       objectIds.push(new mongoose.Types.ObjectId(id));
//     }

//     // ✅ fetch items AND enforce ownership (vendor/branch match) to prevent tampering
//     const dbItems = await MenuItem.find({
//       _id: { $in: objectIds },
//       vendorId: vendorId,
//       branchId: branch.branchId,
//       isActive: true,
//       isAvailable: true,
//     }).lean();

//     const itemMap = new Map(dbItems.map((it) => [String(it._id), it]));

//     const missing = rawIds.filter((id) => !itemMap.has(id));
//     if (missing.length) {
//       return res.status(400).json({
//         error: "Some items are not available for this branch/vendor",
//         missing,
//       });
//     }

//     // --------------------------------------
//     // 2) Server-priced items
//     // --------------------------------------
//     const now = new Date();
//     const orderItems = [];
//     let subtotal = 0;

//     // helper: apply discount to base price (not addons)
//     function applyDiscount(base, discount) {
//       if (!discount || typeof discount !== "object") return base;

//       const type = String(discount.type || "").trim();
//       const value = Number(discount.value ?? 0) || 0;
//       const validUntil = discount.validUntil
//         ? new Date(discount.validUntil)
//         : null;

//       if (validUntil && validUntil.getTime() < now.getTime()) return base; // expired
//       if (!type || value <= 0) return base;

//       if (type === "percentage") {
//         const off = base * (value / 100);
//         return Math.max(0, base - off);
//       }
//       if (type === "amount") {
//         return Math.max(0, base - value);
//       }
//       return base;
//     }

//     for (const reqIt of items) {
//       const mongoId = String(reqIt?.itemId || reqIt?.id || "").trim();
//       const qty = Math.max(parseInt(reqIt?.quantity || "1", 10) || 1, 1);

//       const dbIt = itemMap.get(mongoId);

//       // ---- base price (size OR fixed/offered)
//       let basePrice = 0;
//       let sizeObj = null;

//       if (dbIt.isSizedBased === true) {
//         const sizeLabel = String(
//           reqIt?.size?.label || reqIt?.sizeLabel || "",
//         ).trim();
//         if (!sizeLabel) {
//           return res
//             .status(400)
//             .json({ error: "Missing size for sized item", itemId: mongoId });
//         }
//         const sizes = Array.isArray(dbIt.sizes) ? dbIt.sizes : [];
//         const matched = sizes.find(
//           (s) => String(s?.label || "").trim() === sizeLabel,
//         );
//         if (!matched) {
//           return res.status(400).json({
//             error: "Invalid size selected",
//             itemId: mongoId,
//             sizeLabel,
//           });
//         }
//         basePrice = Number(matched.price ?? 0) || 0;
//         sizeObj = { label: sizeLabel, price: round3(basePrice) };
//       } else {
//         const offered =
//           dbIt.offeredPrice !== undefined ? Number(dbIt.offeredPrice) || 0 : 0;
//         const fixed = Number(dbIt.fixedPrice ?? 0) || 0;
//         basePrice = offered > 0 ? offered : fixed;
//       }

//       // ---- discount (applies to base)
//       basePrice = applyDiscount(basePrice, dbIt.discount);

//       // ---- addons validation by group+option label (because your schema has no option id)
//       const reqAddons = Array.isArray(reqIt?.addons) ? reqIt.addons : [];

//       // group label -> array of selected option labels
//       const selectionsByGroup = new Map();
//       for (const a of reqAddons) {
//         const groupLabel = String(
//           a?.groupLabel || a?.group || a?.addonGroup || "",
//         ).trim();
//         const optionLabel = String(a?.optionLabel || a?.label || "").trim();
//         if (!optionLabel) {
//           return res.status(400).json({
//             error: "Invalid addon (missing option label)",
//             itemId: mongoId,
//           });
//         }
//         const key = groupLabel || "__default__";
//         if (!selectionsByGroup.has(key)) selectionsByGroup.set(key, []);
//         selectionsByGroup.get(key).push(optionLabel);
//       }

//       const finalAddons = [];
//       let addonsTotal = 0;

//       const addonGroups = Array.isArray(dbIt.addons) ? dbIt.addons : [];

//       // validate each request selection against db groups
//       for (const [groupKey, optionLabels] of selectionsByGroup.entries()) {
//         let group = null;

//         if (groupKey !== "__default__") {
//           group = addonGroups.find(
//             (g) =>
//               String(g?.label || "")
//                 .trim()
//                 .toLowerCase() === groupKey.trim().toLowerCase(),
//           );
//           if (!group) {
//             return res.status(400).json({
//               error: "Invalid addon group",
//               itemId: mongoId,
//               groupLabel: groupKey,
//             });
//           }
//         }

//         if (group) {
//           const min = Number(group.min ?? 0) || 0;
//           const max = Number(group.max ?? 1) || 1;

//           if (optionLabels.length < min) {
//             return res.status(400).json({
//               error: "Addon group below min",
//               itemId: mongoId,
//               groupLabel: groupKey,
//               min,
//             });
//           }
//           if (optionLabels.length > max) {
//             return res.status(400).json({
//               error: "Addon group above max",
//               itemId: mongoId,
//               groupLabel: groupKey,
//               max,
//             });
//           }
//         }

//         const allowedOptions = group
//           ? Array.isArray(group.options)
//             ? group.options
//             : []
//           : addonGroups.flatMap((g) =>
//               Array.isArray(g?.options) ? g.options : [],
//             );

//         for (const optLabel of optionLabels) {
//           const opt = allowedOptions.find(
//             (o) =>
//               String(o?.label || "")
//                 .trim()
//                 .toLowerCase() === optLabel.trim().toLowerCase(),
//           );
//           if (!opt) {
//             return res.status(400).json({
//               error: "Invalid addon option",
//               itemId: mongoId,
//               groupLabel: groupKey === "__default__" ? null : groupKey,
//               optionLabel: optLabel,
//             });
//           }

//           const price = Number(opt.price ?? 0) || 0;
//           addonsTotal += price;

//           finalAddons.push({
//             id: String(opt.sku || opt.label || "").trim(),
//             label: String(opt.label || "").trim(),
//             price: round3(price),
//           });
//         }
//       }

//       // also enforce required groups even if user didn’t send them
//       for (const g of addonGroups) {
//         if (g?.required === true) {
//           const key = String(g.label || "")
//             .trim()
//             .toLowerCase();
//           const selectedCount = (
//             selectionsByGroup.get(g.label) ||
//             selectionsByGroup.get(key) ||
//             []
//           ).length;

//           const min = Number(g.min ?? 0) || 0;
//           if (selectedCount < Math.max(1, min)) {
//             return res.status(400).json({
//               error: "Required addon group missing",
//               itemId: mongoId,
//               groupLabel: g.label,
//             });
//           }
//         }
//       }

//       const unitBasePrice = round3(basePrice + addonsTotal);
//       const lineTotal = round3(unitBasePrice * qty);
//       subtotal = round3(subtotal + lineTotal);
//       const stationKey = String(dbIt.kdsStationKey || "MAIN")
//         .trim()
//         .toUpperCase();

//       orderItems.push({
//         itemId: mongoId,
//         nameEnglish: dbIt.nameEnglish || "",
//         nameArabic: dbIt.nameArabic || "",
//         imageUrl: dbIt.imageUrl || "",
//         kdsStationKey: stationKey, // ✅ snapshot per line
//         isSizedBased: dbIt.isSizedBased === true,
//         size: sizeObj,
//         addons: finalAddons,
//         unitBasePrice,
//         quantity: qty,
//         notes: String(reqIt?.notes || ""),
//         lineTotal,
//       });
//     }

//     // --------------------------------------
//     // 3) Taxes & totals (server)
//     // --------------------------------------
//     const serviceChargeAmount = round3(subtotal * (serviceChargePercent / 100));
//     const vatBase = round3(subtotal + serviceChargeAmount);

//     let vatAmount = 0;
//     let grandTotal = 0;
//     let subtotalExVat = vatBase;

//     if (vatPercent > 0) {
//       if (isVatInclusive) {
//         vatAmount = round3(vatBase * (vatPercent / (100 + vatPercent)));
//         subtotalExVat = round3(vatBase - vatAmount);
//         grandTotal = round3(vatBase);
//       } else {
//         vatAmount = round3(vatBase * (vatPercent / 100));
//         subtotalExVat = round3(vatBase);
//         grandTotal = round3(vatBase + vatAmount);
//       }
//     } else {
//       vatAmount = 0;
//       subtotalExVat = round3(vatBase);
//       grandTotal = round3(vatBase);
//     }

//     const pricing = {
//       subtotal: round3(subtotal),
//       serviceChargePercent: round3(serviceChargePercent),
//       serviceChargeAmount,
//       vatPercent: round3(vatPercent),
//       vatAmount,
//       grandTotal,
//       isVatInclusive,
//       subtotalExVat,
//     };

//     let parsedClientCreatedAt = null;
//     if (clientCreatedAt) {
//       const dt = new Date(clientCreatedAt);
//       if (!isNaN(dt.getTime())) {
//         parsedClientCreatedAt = dt;
//       }
//     }

//     let parsedOffset = null;
//     if (clientTzOffsetMinutes !== undefined && clientTzOffsetMinutes !== null) {
//       const off = Number(clientTzOffsetMinutes);
//       if (!Number.isNaN(off) && off >= -840 && off <= 840) {
//         parsedOffset = off;
//       }
//     }

//     const publicToken = crypto.randomBytes(16).toString("hex");

//     // --------------------------------------
//     // 4) Create order (your existing orderNumber/token logic)
//     // --------------------------------------
//     const baseDoc = {
//       vendorId,
//       branchId: branch.branchId,
//       currency: (currency || branch.currency || "BHD").toString().trim(),
//       qr: qr || null,
//       customer: {
//         name: customer?.name || "",
//         phone: customer?.phone || null,
//       },
//       items: orderItems,
//       pricing,
//       remarks: remarks || null,
//       source,
//       status: "Pending",
//       publicToken,
//       clientCreatedAt: parsedClientCreatedAt,
//       clientTzOffsetMinutes: parsedOffset,

//       // ✅ keep your behavior (server time), but use the SAME instant
//       placedAt: orderInstant,

//       // ✅ NEW: snapshot operational window in the order document
//       businessDayLocal: bizWindow.businessDayLocal,
//       businessDayStartUTC: bizWindow.businessDayStartUTC,
//       businessDayEndUTC: bizWindow.businessDayEndUTC,
//     };

//     const counterKey = `orders:daily:${vendorId}:${branch.branchId}:${ymd}`;
//     const MAX_RETRIES = 3;
//     let lastErr = null;

//     for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
//       const seq = await nextSeqByKey(counterKey);
//       const v2 = vendorDigits2(vendorId);
//       const b5 = branchDigits5(branch.branchId);
//       const orderNumber = `${y}${m}${d}${v2}${b5}${leftPad(seq, 7)}`;
//       const tokenNumber = seq;

//       try {
//         const created = await Order.create({
//           ...baseDoc,
//           orderNumber,
//           tokenNumber,
//         });

//         return res.status(201).json({
//           message: "Order placed",
//           order: {
//             id: String(created._id),
//             orderNumber: created.orderNumber,
//             tokenNumber: created.tokenNumber,
//             publicToken: created.publicToken,
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
//             placedAt: created.placedAt,
//             clientCreatedAt: created.clientCreatedAt,
//             clientTzOffsetMinutes: created.clientTzOffsetMinutes,
//           },
//         });
//       } catch (e) {
//         if (e && e.code === 11000 && e.keyPattern && e.keyPattern.orderNumber) {
//           lastErr = e;
//           continue;
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

// ============ PUBLIC: add items to existing order ============
// controllers/orderController.js
// ✅ Modified addItemsToPublicOrder with "reopen flow" logic + revision/cycle tracking
function parseClientIsoWithZone(iso) {
  if (!iso) return null;

  const s = String(iso).trim();
  // Require timezone: ends with Z or has +HH:MM / -HH:MM
  const hasZone = /Z$|[+-]\d{2}:\d{2}$/.test(s);
  if (!hasZone) return null;

  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d;
}

// ✅ Safe fallback: if client sends a timezone-less ISO string, interpret it as "local time"
// using clientTzOffsetMinutes, then convert to the correct UTC instant.
function parseLocalIsoWithOffset(iso, offsetMinutes) {
  if (!iso) return null;
  const s = String(iso).trim();

  // If it already has timezone, don't parse here
  if (/[Zz]$|[+-]\d{2}:\d{2}$/.test(s)) return null;

  const off = Number(offsetMinutes);
  if (Number.isNaN(off) || off < -840 || off > 840) return null;

  // Expect: YYYY-MM-DDTHH:mm[:ss][.SSS]
  const m =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(
      s,
    );
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6] || 0);
  const ms = Number((m[7] || "0").padEnd(3, "0"));

  // local wall-clock -> UTC by subtracting offset minutes
  const utcMs =
    Date.UTC(year, month - 1, day, hour, minute, second, ms) - off * 60 * 1000;

  const d = new Date(utcMs);
  if (isNaN(d.getTime())) return null;
  return d;
}

export const addItemsToPublicOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const token = String(req.query.token || "").trim();

    const { items, clientCreatedAt, clientTzOffsetMinutes } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid order id" });
    }
    if (!token) {
      return res.status(400).json({ error: "Missing token" });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "No items" });
    }

    // 1) load order
    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ error: "Order not found" });

    // token check
    if (String(order.publicToken || "") !== token) {
      return res.status(403).json({ error: "Invalid token" });
    }

    // 2) block ONLY terminal/closed (we ALLOW add-items on READY/SERVED)
    const status = String(order.status || "")
      .trim()
      .toLowerCase();
    const closedStatuses = new Set([
      "completed",
      "cancelled",
      "canceled",
      "rejected",
      "paid",
      "closed",
      "delivered",
    ]);
    if (closedStatuses.has(status)) {
      return res
        .status(409)
        .json({ error: "Order is closed; cannot add items" });
    }

    // 3) load branch (for tax settings + ownership + platform fee settings)
    const branch = await Branch.findOne({ branchId: order.branchId }).lean();
    if (!branch) return res.status(404).json({ error: "Branch not found" });

    // Use tax settings (prefer branch; fall back to existing order.pricing if needed)
    const taxes =
      branch.taxes && typeof branch.taxes === "object" ? branch.taxes : {};

    const vatPercent =
      Number(order?.pricing?.vatPercent ?? taxes.vatPercentage ?? 0) || 0;

    const serviceChargePercent =
      Number(
        order?.pricing?.serviceChargePercent ??
          taxes.serviceChargePercentage ??
          0,
      ) || 0;

    const isVatInclusive =
      order?.pricing?.isVatInclusive === true || taxes.isVatInclusive === true;

    // ✅ platform fee settings (stored in FILS in branch.taxes)
    const showPlatformFee = taxes.showPlatformFee !== false; // default true
    const platformFeePaidByCustomer = taxes.platformFeePaidByCustomer === true; // default false
    const platformFeePerOrderFilsRaw = taxes.platformFeePerOrder ?? 0;
    const platformFeePerOrderFils = Number.isFinite(
      Number(platformFeePerOrderFilsRaw),
    )
      ? Math.max(0, Number(platformFeePerOrderFilsRaw))
      : 0;
    const platformFeePerOrderBhd = platformFeePerOrderFils / 1000; // FILS -> BHD

    const vendorId = branch.vendorId;

    const round3 = (n) =>
      Math.round((Number(n || 0) + Number.EPSILON) * 1000) / 1000;

    // helper: apply discount to base price (not addons)
    const now = new Date();
    function applyDiscount(base, discount) {
      if (!discount || typeof discount !== "object") return base;

      const type = String(discount.type || "").trim();
      const value = Number(discount.value ?? 0) || 0;
      const validUntil = discount.validUntil
        ? new Date(discount.validUntil)
        : null;

      if (validUntil && validUntil.getTime() < now.getTime()) return base;
      if (!type || value <= 0) return base;

      if (type === "percentage")
        return Math.max(0, base - base * (value / 100));
      if (type === "amount") return Math.max(0, base - value);
      return base;
    }

    // 4) Build ObjectIds from request
    const rawIds = [
      ...new Set(
        items
          .map((x) => String(x?.itemId || x?.id || "").trim())
          .filter(Boolean),
      ),
    ];
    if (rawIds.length === 0) {
      return res
        .status(400)
        .json({ error: "Invalid items payload (no itemId)" });
    }

    const objectIds = [];
    for (const itemId of rawIds) {
      if (!mongoose.Types.ObjectId.isValid(itemId)) {
        return res.status(400).json({ error: "Invalid itemId", itemId });
      }
      objectIds.push(new mongoose.Types.ObjectId(itemId));
    }

    // fetch items and enforce vendor/branch ownership
    const dbItems = await MenuItem.find({
      _id: { $in: objectIds },
      vendorId: vendorId,
      branchId: branch.branchId,
      isActive: true,
      isAvailable: true,
    }).lean();

    const itemMap = new Map(dbItems.map((it) => [String(it._id), it]));
    const missing = rawIds.filter((x) => !itemMap.has(x));
    if (missing.length) {
      return res.status(400).json({
        error: "Some items are not available for this branch/vendor",
        missing,
      });
    }

    // 5) Build server-priced new items
    const newOrderItems = [];
    let addedSubtotal = 0;

    for (const reqIt of items) {
      const mongoId = String(reqIt?.itemId || reqIt?.id || "").trim();
      const qty = Math.max(parseInt(reqIt?.quantity || "1", 10) || 1, 1);
      const dbIt = itemMap.get(mongoId);

      // base price
      let basePrice = 0;
      let sizeObj = null;

      if (dbIt.isSizedBased === true) {
        const sizeLabel = String(
          reqIt?.size?.label || reqIt?.sizeLabel || "",
        ).trim();
        if (!sizeLabel) {
          return res.status(400).json({
            error: "Missing size for sized item",
            itemId: mongoId,
          });
        }
        const sizes = Array.isArray(dbIt.sizes) ? dbIt.sizes : [];
        const matched = sizes.find(
          (s) => String(s?.label || "").trim() === sizeLabel,
        );
        if (!matched) {
          return res.status(400).json({
            error: "Invalid size selected",
            itemId: mongoId,
            sizeLabel,
          });
        }
        basePrice = Number(matched.price ?? 0) || 0;
        sizeObj = { label: sizeLabel, price: round3(basePrice) };
      } else {
        const offered =
          dbIt.offeredPrice !== undefined ? Number(dbIt.offeredPrice) || 0 : 0;
        const fixed = Number(dbIt.fixedPrice ?? 0) || 0;
        basePrice = offered > 0 ? offered : fixed;
      }

      // discount
      basePrice = applyDiscount(basePrice, dbIt.discount);

      // addons validation (same style as createOrder)
      const reqAddons = Array.isArray(reqIt?.addons) ? reqIt.addons : [];
      const selectionsByGroup = new Map();

      for (const a of reqAddons) {
        const groupLabel = String(
          a?.groupLabel || a?.group || a?.addonGroup || "",
        ).trim();
        const optionLabel = String(a?.optionLabel || a?.label || "").trim();
        if (!optionLabel) {
          return res.status(400).json({
            error: "Invalid addon (missing option label)",
            itemId: mongoId,
          });
        }
        const key = groupLabel || "__default__";
        if (!selectionsByGroup.has(key)) selectionsByGroup.set(key, []);
        selectionsByGroup.get(key).push(optionLabel);
      }

      const addonGroups = Array.isArray(dbIt.addons) ? dbIt.addons : [];
      const finalAddons = [];
      let addonsTotal = 0;

      for (const [groupKey, optionLabels] of selectionsByGroup.entries()) {
        let group = null;

        if (groupKey !== "__default__") {
          group = addonGroups.find(
            (g) =>
              String(g?.label || "")
                .trim()
                .toLowerCase() === groupKey.trim().toLowerCase(),
          );
          if (!group) {
            return res.status(400).json({
              error: "Invalid addon group",
              itemId: mongoId,
              groupLabel: groupKey,
            });
          }
        }

        if (group) {
          const min = Number(group.min ?? 0) || 0;
          const max = Number(group.max ?? 1) || 1;

          if (optionLabels.length < min) {
            return res.status(400).json({
              error: "Addon group below min",
              itemId: mongoId,
              groupLabel: groupKey,
              min,
            });
          }
          if (optionLabels.length > max) {
            return res.status(400).json({
              error: "Addon group above max",
              itemId: mongoId,
              groupLabel: groupKey,
              max,
            });
          }
        }

        const allowedOptions = group
          ? Array.isArray(group.options)
            ? group.options
            : []
          : addonGroups.flatMap((g) =>
              Array.isArray(g?.options) ? g.options : [],
            );

        for (const optLabel of optionLabels) {
          const opt = allowedOptions.find(
            (o) =>
              String(o?.label || "")
                .trim()
                .toLowerCase() === optLabel.trim().toLowerCase(),
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

          finalAddons.push({
            id: String(opt.sku || opt.label || "").trim(),
            label: String(opt.label || "").trim(),
            price: round3(price),
          });
        }
      }

      // enforce required groups
      for (const g of addonGroups) {
        if (g?.required === true) {
          const selectedCount = (
            selectionsByGroup.get(String(g.label || "").trim()) || []
          ).length;

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
      addedSubtotal = round3(addedSubtotal + lineTotal);
      const stationKey = String(dbIt.kdsStationKey || "MAIN")
        .trim()
        .toUpperCase();

      newOrderItems.push({
        itemId: mongoId,
        nameEnglish: dbIt.nameEnglish || "",
        nameArabic: dbIt.nameArabic || "",
        imageUrl: dbIt.imageUrl || "",
        kdsStationKey: stationKey,
        isSizedBased: dbIt.isSizedBased === true,
        size: sizeObj,
        addons: finalAddons,
        unitBasePrice,
        quantity: qty,
        notes: String(reqIt?.notes || ""),
        lineTotal,
      });
    }

    // 6) Recalculate pricing (subtotal/service/vat/grand) + ✅ platform fee
    const oldSubtotal = Number(order?.pricing?.subtotal || 0) || 0;
    const newSubtotal = round3(oldSubtotal + addedSubtotal);

    const serviceChargeAmount = round3(
      newSubtotal * (serviceChargePercent / 100),
    );
    const vatBase = round3(newSubtotal + serviceChargeAmount);

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

    // ✅ Platform fee is per ORDER (not per item). Keep it consistent.
    // If the customer is paying it, always include it (even after add-more).
    const platformFee = platformFeePaidByCustomer
      ? round3(platformFeePerOrderBhd)
      : 0;

    grandTotal = round3(grandTotal + platformFee);

    // 7) Apply changes to order
    order.items = [...(order.items || []), ...newOrderItems];
    order.pricing = {
      subtotal: round3(newSubtotal),
      serviceChargePercent: round3(serviceChargePercent),
      serviceChargeAmount,
      vatPercent: round3(vatPercent),
      vatAmount,
      grandTotal,
      isVatInclusive,
      subtotalExVat,

      // ✅ platform fee fields (same as createOrder)
      platformFee, // BHD
      platformFeePaidByCustomer,
      showPlatformFee,
      platformFeePerOrderFils: Math.round(platformFeePerOrderFils),
    };

    // ✅ optional client timestamps (SAFE parse)
    let parsedClientCreatedAt =
      parseClientIsoWithZone(clientCreatedAt) ??
      parseLocalIsoWithOffset(clientCreatedAt, clientTzOffsetMinutes);

    let parsedOffset = null;
    if (clientTzOffsetMinutes !== undefined && clientTzOffsetMinutes !== null) {
      const off = Number(clientTzOffsetMinutes);
      if (!Number.isNaN(off) && off >= -840 && off <= 840) parsedOffset = off;
    }

    order.clientCreatedAt = parsedClientCreatedAt ?? order.clientCreatedAt;
    order.clientTzOffsetMinutes = parsedOffset ?? order.clientTzOffsetMinutes;

    // 8) ✅ REOPEN FLOW LOGIC + REVISION/CYCLE
    const beforeLabel = String(order.status || "").trim();
    const before = beforeLabel.toLowerCase();

    order.revision = Number(order.revision || 0) || 0;
    order.kitchenCycle = Number(order.kitchenCycle || 1) || 1;
    order.servedHistory = Array.isArray(order.servedHistory)
      ? order.servedHistory
      : [];

    if (before === "ready" || before === "served") {
      if (before === "served") {
        order.kitchenCycle = (Number(order.kitchenCycle || 1) || 1) + 1;
      }
      order.status = "Preparing";
      order.readyAt = null;
      order.servedAt = null;
      order.revision += 1;
    } else {
      order.revision += 1;
    }

    await order.save();

    await publishOrderFanout({
  branchId: order.branchId,
  eventName: "order.updated",
  payload: {
    type: "order.updated",
    updateType: "amended",
    branchId: order.branchId,
    orderId: String(order._id),
    tokenNumber: order.tokenNumber ?? null,
    revision: order.revision ?? 0,
    status: order.status,
  },
  items: order.items || [],
});

    return res.status(200).json({
      message: "Items added",
      order: {
        id: String(order._id),
        orderNumber: order.orderNumber,
        tokenNumber: order.tokenNumber,
        branchId: order.branchId,
        vendorId: order.vendorId ?? null,
        currency: order.currency,
        status: order.status,
        revision: order.revision ?? 0,
        kitchenCycle: order.kitchenCycle ?? 1,
        qr: order.qr,
        customer: order.customer,
        items: order.items,
        pricing: order.pricing, // ✅ includes platform fee + updated grandTotal
        remarks: order.remarks ?? null,
        source: order.source ?? "customer_view",
        placedAt: order.placedAt ?? null,
        createdAt: order.createdAt ?? null,
        updatedAt: order.updatedAt ?? null,
        readyAt: order.readyAt ?? null,
        servedAt: order.servedAt ?? null,
        servedHistory: order.servedHistory ?? [],
      },
    });
  } catch (err) {
    console.error("addItemsToPublicOrder error:", err);
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
        items: order.items || [],
        pricing: order.pricing || null, // ✅ now includes platformFee fields
        remarks: order.remarks ?? null,
        source: order.source ?? "customer_view",
        placedAt: order.placedAt ?? null,
        createdAt: order.createdAt ?? null,

        // (optional but useful to client)
        updatedAt: order.updatedAt ?? null,
        clientCreatedAt: order.clientCreatedAt ?? null,
        clientTzOffsetMinutes: order.clientTzOffsetMinutes ?? null,
      },
    });
  } catch (err) {
    console.error("getPublicOrderById error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};

// export const addItemsToPublicOrder = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const token = String(req.query.token || "").trim();

//     const { items, clientCreatedAt, clientTzOffsetMinutes } = req.body || {};

//     if (!mongoose.Types.ObjectId.isValid(id)) {
//       return res.status(400).json({ error: "Invalid order id" });
//     }
//     if (!token) {
//       return res.status(400).json({ error: "Missing token" });
//     }
//     if (!Array.isArray(items) || items.length === 0) {
//       return res.status(400).json({ error: "No items" });
//     }

//     // 1) load order
//     const order = await Order.findById(id);
//     if (!order) return res.status(404).json({ error: "Order not found" });

//     // token check
//     if (String(order.publicToken || "") !== token) {
//       return res.status(403).json({ error: "Invalid token" });
//     }

//     // 2) block ONLY terminal/closed (we ALLOW add-items on READY/SERVED)
//     const status = String(order.status || "")
//       .trim()
//       .toLowerCase();
//     const closedStatuses = new Set([
//       "completed",
//       "cancelled",
//       "canceled",
//       "rejected",
//       "paid",
//       "closed",
//       "delivered",
//     ]);
//     if (closedStatuses.has(status)) {
//       return res
//         .status(409)
//         .json({ error: "Order is closed; cannot add items" });
//     }

//     // 3) load branch (for tax settings + ownership)
//     const branch = await Branch.findOne({ branchId: order.branchId }).lean();
//     if (!branch) return res.status(404).json({ error: "Branch not found" });

//     // Use tax settings (prefer branch; fall back to existing order.pricing if needed)
//     const taxes =
//       branch.taxes && typeof branch.taxes === "object" ? branch.taxes : {};
//     const vatPercent =
//       Number(order?.pricing?.vatPercent ?? taxes.vatPercentage ?? 0) || 0;
//     const serviceChargePercent =
//       Number(
//         order?.pricing?.serviceChargePercent ??
//           taxes.serviceChargePercentage ??
//           0,
//       ) || 0;
//     const isVatInclusive =
//       order?.pricing?.isVatInclusive === true || taxes.isVatInclusive === true;

//     const vendorId = branch.vendorId;

//     const round3 = (n) =>
//       Math.round((Number(n || 0) + Number.EPSILON) * 1000) / 1000;

//     // helper: apply discount to base price (not addons)
//     const now = new Date();
//     function applyDiscount(base, discount) {
//       if (!discount || typeof discount !== "object") return base;

//       const type = String(discount.type || "").trim();
//       const value = Number(discount.value ?? 0) || 0;
//       const validUntil = discount.validUntil
//         ? new Date(discount.validUntil)
//         : null;

//       if (validUntil && validUntil.getTime() < now.getTime()) return base;
//       if (!type || value <= 0) return base;

//       if (type === "percentage")
//         return Math.max(0, base - base * (value / 100));
//       if (type === "amount") return Math.max(0, base - value);
//       return base;
//     }

//     // 4) Build ObjectIds from request
//     const rawIds = [
//       ...new Set(
//         items
//           .map((x) => String(x?.itemId || x?.id || "").trim())
//           .filter(Boolean),
//       ),
//     ];
//     if (rawIds.length === 0) {
//       return res
//         .status(400)
//         .json({ error: "Invalid items payload (no itemId)" });
//     }

//     const objectIds = [];
//     for (const itemId of rawIds) {
//       if (!mongoose.Types.ObjectId.isValid(itemId)) {
//         return res.status(400).json({ error: "Invalid itemId", itemId });
//       }
//       objectIds.push(new mongoose.Types.ObjectId(itemId));
//     }

//     // fetch items and enforce vendor/branch ownership
//     const dbItems = await MenuItem.find({
//       _id: { $in: objectIds },
//       vendorId: vendorId,
//       branchId: branch.branchId,
//       isActive: true,
//       isAvailable: true,
//     }).lean();

//     const itemMap = new Map(dbItems.map((it) => [String(it._id), it]));
//     const missing = rawIds.filter((x) => !itemMap.has(x));
//     if (missing.length) {
//       return res.status(400).json({
//         error: "Some items are not available for this branch/vendor",
//         missing,
//       });
//     }

//     // 5) Build server-priced new items
//     const newOrderItems = [];
//     let addedSubtotal = 0;

//     for (const reqIt of items) {
//       const mongoId = String(reqIt?.itemId || reqIt?.id || "").trim();
//       const qty = Math.max(parseInt(reqIt?.quantity || "1", 10) || 1, 1);
//       const dbIt = itemMap.get(mongoId);

//       // base price
//       let basePrice = 0;
//       let sizeObj = null;

//       if (dbIt.isSizedBased === true) {
//         const sizeLabel = String(
//           reqIt?.size?.label || reqIt?.sizeLabel || "",
//         ).trim();
//         if (!sizeLabel) {
//           return res.status(400).json({
//             error: "Missing size for sized item",
//             itemId: mongoId,
//           });
//         }
//         const sizes = Array.isArray(dbIt.sizes) ? dbIt.sizes : [];
//         const matched = sizes.find(
//           (s) => String(s?.label || "").trim() === sizeLabel,
//         );
//         if (!matched) {
//           return res.status(400).json({
//             error: "Invalid size selected",
//             itemId: mongoId,
//             sizeLabel,
//           });
//         }
//         basePrice = Number(matched.price ?? 0) || 0;
//         sizeObj = { label: sizeLabel, price: round3(basePrice) };
//       } else {
//         const offered =
//           dbIt.offeredPrice !== undefined ? Number(dbIt.offeredPrice) || 0 : 0;
//         const fixed = Number(dbIt.fixedPrice ?? 0) || 0;
//         basePrice = offered > 0 ? offered : fixed;
//       }

//       // discount
//       basePrice = applyDiscount(basePrice, dbIt.discount);

//       // addons validation (same style as createOrder)
//       const reqAddons = Array.isArray(reqIt?.addons) ? reqIt.addons : [];
//       const selectionsByGroup = new Map();

//       for (const a of reqAddons) {
//         const groupLabel = String(
//           a?.groupLabel || a?.group || a?.addonGroup || "",
//         ).trim();
//         const optionLabel = String(a?.optionLabel || a?.label || "").trim();
//         if (!optionLabel) {
//           return res.status(400).json({
//             error: "Invalid addon (missing option label)",
//             itemId: mongoId,
//           });
//         }
//         const key = groupLabel || "__default__";
//         if (!selectionsByGroup.has(key)) selectionsByGroup.set(key, []);
//         selectionsByGroup.get(key).push(optionLabel);
//       }

//       const addonGroups = Array.isArray(dbIt.addons) ? dbIt.addons : [];
//       const finalAddons = [];
//       let addonsTotal = 0;

//       for (const [groupKey, optionLabels] of selectionsByGroup.entries()) {
//         let group = null;

//         if (groupKey !== "__default__") {
//           group = addonGroups.find(
//             (g) =>
//               String(g?.label || "")
//                 .trim()
//                 .toLowerCase() === groupKey.trim().toLowerCase(),
//           );
//           if (!group) {
//             return res.status(400).json({
//               error: "Invalid addon group",
//               itemId: mongoId,
//               groupLabel: groupKey,
//             });
//           }
//         }

//         if (group) {
//           const min = Number(group.min ?? 0) || 0;
//           const max = Number(group.max ?? 1) || 1;

//           if (optionLabels.length < min) {
//             return res.status(400).json({
//               error: "Addon group below min",
//               itemId: mongoId,
//               groupLabel: groupKey,
//               min,
//             });
//           }
//           if (optionLabels.length > max) {
//             return res.status(400).json({
//               error: "Addon group above max",
//               itemId: mongoId,
//               groupLabel: groupKey,
//               max,
//             });
//           }
//         }

//         const allowedOptions = group
//           ? Array.isArray(group.options)
//             ? group.options
//             : []
//           : addonGroups.flatMap((g) =>
//               Array.isArray(g?.options) ? g.options : [],
//             );

//         for (const optLabel of optionLabels) {
//           const opt = allowedOptions.find(
//             (o) =>
//               String(o?.label || "")
//                 .trim()
//                 .toLowerCase() === optLabel.trim().toLowerCase(),
//           );
//           if (!opt) {
//             return res.status(400).json({
//               error: "Invalid addon option",
//               itemId: mongoId,
//               groupLabel: groupKey === "__default__" ? null : groupKey,
//               optionLabel: optLabel,
//             });
//           }

//           const price = Number(opt.price ?? 0) || 0;
//           addonsTotal += price;

//           finalAddons.push({
//             id: String(opt.sku || opt.label || "").trim(),
//             label: String(opt.label || "").trim(),
//             price: round3(price),
//           });
//         }
//       }

//       // enforce required groups
//       for (const g of addonGroups) {
//         if (g?.required === true) {
//           const selectedCount = (
//             selectionsByGroup.get(String(g.label || "").trim()) || []
//           ).length;

//           const min = Number(g.min ?? 0) || 0;
//           if (selectedCount < Math.max(1, min)) {
//             return res.status(400).json({
//               error: "Required addon group missing",
//               itemId: mongoId,
//               groupLabel: g.label,
//             });
//           }
//         }
//       }

//       const unitBasePrice = round3(basePrice + addonsTotal);
//       const lineTotal = round3(unitBasePrice * qty);
//       addedSubtotal = round3(addedSubtotal + lineTotal);
//       const stationKey = String(dbIt.kdsStationKey || "MAIN")
//         .trim()
//         .toUpperCase();

//       newOrderItems.push({
//         itemId: mongoId,
//         nameEnglish: dbIt.nameEnglish || "",
//         nameArabic: dbIt.nameArabic || "",
//         imageUrl: dbIt.imageUrl || "",
//         kdsStationKey: stationKey, // ✅ snapshot per line
//         isSizedBased: dbIt.isSizedBased === true,
//         size: sizeObj,
//         addons: finalAddons,
//         unitBasePrice,
//         quantity: qty,
//         notes: String(reqIt?.notes || ""),
//         lineTotal,
//       });
//     }

//     // 6) Recalculate pricing (subtotal/service/vat/grand)
//     const oldSubtotal = Number(order?.pricing?.subtotal || 0) || 0;
//     const newSubtotal = round3(oldSubtotal + addedSubtotal);

//     const serviceChargeAmount = round3(
//       newSubtotal * (serviceChargePercent / 100),
//     );
//     const vatBase = round3(newSubtotal + serviceChargeAmount);

//     let vatAmount = 0;
//     let grandTotal = 0;
//     let subtotalExVat = vatBase;

//     if (vatPercent > 0) {
//       if (isVatInclusive) {
//         vatAmount = round3(vatBase * (vatPercent / (100 + vatPercent)));
//         subtotalExVat = round3(vatBase - vatAmount);
//         grandTotal = round3(vatBase);
//       } else {
//         vatAmount = round3(vatBase * (vatPercent / 100));
//         subtotalExVat = round3(vatBase);
//         grandTotal = round3(vatBase + vatAmount);
//       }
//     } else {
//       vatAmount = 0;
//       subtotalExVat = round3(vatBase);
//       grandTotal = round3(vatBase);
//     }

//     // 7) Apply changes to order
//     order.items = [...(order.items || []), ...newOrderItems];
//     order.pricing = {
//       subtotal: round3(newSubtotal),
//       serviceChargePercent: round3(serviceChargePercent),
//       serviceChargeAmount,
//       vatPercent: round3(vatPercent),
//       vatAmount,
//       grandTotal,
//       isVatInclusive,
//       subtotalExVat,
//     };

//     // ✅ optional client timestamps (SAFE parse)
//     let parsedClientCreatedAt =
//       parseClientIsoWithZone(clientCreatedAt) ??
//       parseLocalIsoWithOffset(clientCreatedAt, clientTzOffsetMinutes);

//     let parsedOffset = null;
//     if (clientTzOffsetMinutes !== undefined && clientTzOffsetMinutes !== null) {
//       const off = Number(clientTzOffsetMinutes);
//       if (!Number.isNaN(off) && off >= -840 && off <= 840) parsedOffset = off;
//     }

//     // keep a simple audit trail (optional but useful)
//     order.clientCreatedAt = parsedClientCreatedAt ?? order.clientCreatedAt;
//     order.clientTzOffsetMinutes = parsedOffset ?? order.clientTzOffsetMinutes;

//     // 8) ✅ REOPEN FLOW LOGIC + REVISION/CYCLE
//     // If order was READY or SERVED, adding items should reopen to PREPARING (same order).
//     const beforeLabel = String(order.status || "").trim();
//     const before = beforeLabel.toLowerCase();
//     const now2 = new Date();

//     // ensure defaults exist (schema should have them, but safe)
//     order.revision = Number(order.revision || 0) || 0;
//     order.kitchenCycle = Number(order.kitchenCycle || 1) || 1;
//     order.servedHistory = Array.isArray(order.servedHistory)
//       ? order.servedHistory
//       : [];

//     if (before === "ready" || before === "served") {
//       // If it was SERVED, start a new kitchen cycle (round)
//       if (before === "served") {
//         order.kitchenCycle = (Number(order.kitchenCycle || 1) || 1) + 1;
//       }

//       // reopen kitchen flow
//       order.status = "Preparing";
//       order.readyAt = null;
//       order.servedAt = null;

//       // bump revision because this is a meaningful kitchen change
//       order.revision += 1;
//     } else {
//       // Even if it's pending/preparing/etc, bump revision so KDS can detect add-more
//       order.revision += 1;
//     }

//     await order.save();

//     return res.status(200).json({
//       message: "Items added",
//       order: {
//         id: String(order._id),
//         orderNumber: order.orderNumber,
//         tokenNumber: order.tokenNumber,
//         branchId: order.branchId,
//         vendorId: order.vendorId ?? null,
//         currency: order.currency,
//         status: order.status,
//         revision: order.revision ?? 0,
//         kitchenCycle: order.kitchenCycle ?? 1,
//         qr: order.qr,
//         customer: order.customer,
//         items: order.items,
//         pricing: order.pricing,
//         remarks: order.remarks ?? null,
//         source: order.source ?? "customer_view",
//         placedAt: order.placedAt ?? null,
//         createdAt: order.createdAt ?? null,
//         updatedAt: order.updatedAt ?? null,
//         readyAt: order.readyAt ?? null,
//         servedAt: order.servedAt ?? null,
//         servedHistory: order.servedHistory ?? [],
//       },
//     });
//   } catch (err) {
//     console.error("addItemsToPublicOrder error:", err);
//     return res.status(500).json({ error: err.message || "Server error" });
//   }
// };

// export const getPublicOrderById = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const token = String(req.query.token || "").trim();

//     if (!mongoose.Types.ObjectId.isValid(id)) {
//       return res.status(400).json({ error: "Invalid order id" });
//     }
//     if (!token) {
//       return res.status(400).json({ error: "Missing token" });
//     }

//     const order = await Order.findById(id).lean();
//     if (!order) return res.status(404).json({ error: "Order not found" });

//     if (String(order.publicToken || "") !== token) {
//       return res.status(403).json({ error: "Invalid token" });
//     }

//     return res.status(200).json({
//       order: {
//         id: String(order._id),
//         orderNumber: order.orderNumber,
//         tokenNumber: order.tokenNumber,
//         branchId: order.branchId,
//         currency: order.currency,
//         status: order.status,
//         qr: order.qr,
//         customer: order.customer,
//         items: order.items,
//         pricing: order.pricing,
//         remarks: order.remarks ?? null,
//         source: order.source ?? "customer_view",
//         placedAt: order.placedAt ?? null,
//         createdAt: order.createdAt ?? null,
//       },
//     });
//   } catch (err) {
//     console.error("getPublicOrderById error:", err);
//     return res.status(500).json({ error: err.message || "Server error" });
//   }
// };

// ============ PUBLIC: get order details by publicToken ============
export const getPublicOrderByToken = async (req, res) => {
  try {
    const token = String(req.params.token || "").trim();

    // optional context guards (recommended)
    const branchId = String(req.query.branchId || "").trim();
    const qrId = String(req.query.qrId || "").trim();

    if (!token) return res.status(400).json({ error: "Missing token" });

    const order = await Order.findOne({ publicToken: token }).lean();
    if (!order) return res.status(404).json({ error: "Order not found" });

    // ✅ optional protection: ensure the token is used ONLY in same branch/table context
    if (branchId && String(order.branchId || "") !== branchId) {
      return res.status(404).json({ error: "Order not found" });
    }
    if (qrId && String(order?.qr?.qrId || "") !== qrId) {
      return res.status(404).json({ error: "Order not found" });
    }

    return res.status(200).json({
      message: "OK",
      order: {
        id: String(order._id),
        orderNumber: order.orderNumber,
        tokenNumber: order.tokenNumber,
        publicToken: order.publicToken,

        vendorId: order.vendorId,
        branchId: order.branchId,
        currency: order.currency,
        status: order.status,

        qr: order.qr || null,
        customer: order.customer || null,
        items: order.items || [],
        pricing: order.pricing || null,

        remarks: order.remarks ?? null,
        source: order.source ?? "customer_view",

        placedAt: order.placedAt ?? null,
        createdAt: order.createdAt ?? null,
        clientCreatedAt: order.clientCreatedAt ?? null,
        clientTzOffsetMinutes: order.clientTzOffsetMinutes ?? null,
      },
    });
  } catch (err) {
    console.error("getPublicOrderByToken error:", err);
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
      return res
        .status(400)
        .json({ error: "Provide at least vendor or branch in query" });
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
    const {
      fromYmd,
      toYmd,
      period: periodUsed,
    } = await resolveRange({
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
      { subtotal: 0, serviceCharge: 0, vat: 0, grand: 0 },
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
        items: o.items || [], // keep for printing
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
