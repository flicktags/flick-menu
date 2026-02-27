// src/controllers/kdsController.js
import { DateTime } from "luxon";
import mongoose from "mongoose";
import Branch from "../models/Branch.js";
import Order from "../models/Order.js";
import Qr from "../models/QrCodeOrders.js"; // ✅ or whatever your QR model file is called
import HelpRequest from "../models/HelpRequest.js";
import bcrypt from "bcryptjs";
import BranchWalletAccount from "../models/BranchWalletAccount.js";
import BillingLedger from "../models/BillingLedger.js";
import {
  generateLedgerId,
  readBranchUnitFeeFils,
} from "../utils/billingWallet.js";
// import { publishOrderFanout } from "../realtime/ablyPublisher.js";
import {
  publishOrderFanout,
  publishEvent,
  branchChannel,
} from "../realtime/ablyPublisher.js";

const DAY_KEYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ==============================
// Shift window helpers
// ==============================
function parseRange(rangeStr) {
  const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(
    String(rangeStr || "").trim(),
  );
  if (!m) return null;
  return {
    startH: Number(m[1]),
    startM: Number(m[2]),
    endH: Number(m[3]),
    endM: Number(m[4]),
  };
}

function buildShiftWindowForDay(baseDate, range, tz) {
  const start = baseDate.set({
    hour: range.startH,
    minute: range.startM,
    second: 0,
    millisecond: 0,
  });
  let end = baseDate.set({
    hour: range.endH,
    minute: range.endM,
    second: 0,
    millisecond: 0,
  });
  if (end <= start) end = end.plus({ days: 1 });
  return { start, end };
}

function getDayKey(dt) {
  return DAY_KEYS[dt.weekday - 1];
}

function resolveCurrentShiftWindow({ openingHours, tz, now }) {
  const nowTz = now ? now.setZone(tz) : DateTime.now().setZone(tz);

  const todayKey = getDayKey(nowTz);
  const todayRange = parseRange(openingHours?.[todayKey]);

  const todayBase = nowTz.startOf("day");
  const todayWindow = todayRange
    ? buildShiftWindowForDay(todayBase, todayRange, tz)
    : null;

  const yTz = nowTz.minus({ days: 1 });
  const yKey = getDayKey(yTz);
  const yRange = parseRange(openingHours?.[yKey]);
  const yBase = yTz.startOf("day");
  const yWindow = yRange ? buildShiftWindowForDay(yBase, yRange, tz) : null;

  if (yWindow && nowTz >= yWindow.start && nowTz < yWindow.end) {
    return {
      startTz: yWindow.start,
      endTz: yWindow.end,
      label: `${yKey} ${yWindow.start.toFormat("HH:mm")} → ${getDayKey(
        yWindow.end,
      )} ${yWindow.end.toFormat("HH:mm")}`,
    };
  }

  if (todayWindow) {
    return {
      startTz: todayWindow.start,
      endTz: todayWindow.end,
      label: `${todayKey} ${todayWindow.start.toFormat("HH:mm")} → ${getDayKey(
        todayWindow.end,
      )} ${todayWindow.end.toFormat("HH:mm")}`,
    };
  }

  const start = nowTz.startOf("day");
  const end = start.plus({ days: 1 });
  return {
    startTz: start,
    endTz: end,
    label: `${todayKey} ${start.toFormat("HH:mm")} → ${getDayKey(end)} ${end.toFormat(
      "HH:mm",
    )}`,
  };
}

// ==============================
// Status helpers
// ==============================
function normalizeStatus(s) {
  return String(s || "")
    .trim()
    .toLowerCase();
}

function classifyStatus(raw) {
  const s = normalizeStatus(raw);

  // ✅ Active tab should include your kitchen flow
  if (["pending", "accepted", "preparing", "ready"].includes(s))
    return "active";

  // ✅ Completed tab
  if (["served", "completed", "paid", "closed", "delivered"].includes(s))
    return "completed";

  // ✅ Cancelled tab
  if (["cancelled", "canceled", "void", "rejected"].includes(s))
    return "cancelled";

  return "active";
}

function num(v, d = 0) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : d;
}

function lineTotalOf(it) {
  const qty = Math.max(1, Math.trunc(num(it.quantity, 1)));
  // Prefer stored lineTotal
  const lt = num(it.lineTotal, NaN);
  if (Number.isFinite(lt)) return lt;

  // Fallback: assume unitBasePrice is final per-unit price
  const unit = num(it.unitBasePrice, 0);
  return unit * qty;
}

/**
 * Mutates order.pricing to reflect ONLY AVAILABLE lines in order.items.
 * Used for:
 * - out-of-stock adjustments
 * - station-filtered views (so station sees its own totals)
 */
function recomputeOrderPricing(order) {
  const pricing = order.pricing || {};

  const vatPercent = num(pricing.vatPercent, 0);
  const scPercent = num(pricing.serviceChargePercent, 0);
  const isVatInclusive = !!pricing.isVatInclusive;

  // ✅ Subtotal = sum of AVAILABLE lines only
  const subtotal = (order.items || [])
    .filter((it) => String(it.availability || "AVAILABLE") !== "OUT_OF_STOCK")
    .reduce((acc, it) => acc + lineTotalOf(it), 0);

  // Consistent model:
  // - VAT inclusive: extract net from subtotal, compute SC on net, VAT on (net + SC)
  // - VAT exclusive: net = subtotal, SC on net, VAT on (net + SC)
  const vatRate = vatPercent / 100;
  const scRate = scPercent / 100;

  const net =
    isVatInclusive && vatRate > 0 ? subtotal / (1 + vatRate) : subtotal;
  const serviceChargeAmount = net * scRate;

  const taxable = net + serviceChargeAmount;
  const vatAmount = vatRate > 0 ? taxable * vatRate : 0;

  const grandTotal = taxable + vatAmount;

  order.pricing = {
    ...pricing,
    subtotal,
    subtotalExVat: net,
    serviceChargeAmount,
    vatAmount,
    grandTotal,
  };
}

// ---------- helpers for status parsing ----------
const STATUS_CODE_TO_LABEL = {
  PENDING: "Pending",
  ACCEPTED: "Accepted",
  PREPARING: "Preparing",
  READY: "Ready",
  SERVED: "Served",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  REJECTED: "Rejected",
};

const toCode = (s) =>
  String(s || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");

const toLabel = (incoming) => {
  const code = toCode(incoming);
  if (STATUS_CODE_TO_LABEL[code]) return STATUS_CODE_TO_LABEL[code];

  // try match by label value
  const found = Object.values(STATUS_CODE_TO_LABEL).find(
    (lbl) => toCode(lbl) === code,
  );
  return found || null;
};

const isTerminal = (label) => {
  const s = normalizeStatus(label);
  return ["completed", "cancelled", "canceled", "rejected"].includes(s);
};

function canTransition(currentLabel, nextLabel) {
  const cur = toCode(currentLabel); // works for label too
  const nxt = toCode(nextLabel);

  // allow same status (idempotent)
  if (cur === nxt) return true;

  // Terminal cannot move
  if (isTerminal(currentLabel)) return false;

  // Define allowed moves
  const rules = {
    PENDING: new Set(["PREPARING", "REJECTED", "CANCELLED"]),
    ACCEPTED: new Set(["PREPARING", "CANCELLED"]),
    PREPARING: new Set(["READY", "CANCELLED"]),
    READY: new Set(["SERVED"]),
    SERVED: new Set(["COMPLETED"]),
  };

  const allowed = rules[cur];
  if (!allowed) return false;
  return allowed.has(nxt);
}

// ==============================
// Station helpers (NEW)
// ==============================
function normStationKey(v) {
  const s = String(v ?? "").trim();
  return s ? s.toUpperCase() : "";
}

function normStationFromItem(v) {
  const s = String(v ?? "").trim();
  return s ? s.toUpperCase() : "MAIN";
}

function computeStationSummary(items) {
  const list = Array.isArray(items) ? items : [];
  const map = new Map(); // key -> { itemCount, qtyTotal }

  for (const it of list) {
    const k = normStationFromItem(it?.kdsStationKey);
    const qty = Math.max(1, parseInt(it?.quantity ?? 1, 10) || 1);

    const cur = map.get(k) || { itemCount: 0, qtyTotal: 0 };
    cur.itemCount += 1;
    cur.qtyTotal += qty;
    map.set(k, cur);
  }

  return Array.from(map.entries()).map(([stationKey, v]) => ({
    stationKey,
    itemCount: v.itemCount,
    qtyTotal: v.qtyTotal,
  }));
}

// // ✅ Backward compatibility: treat missing kdsStatus as PENDING
// // ✅ Backward compatibility: treat missing kdsStatus as PENDING
// const safeItems = (order.items || []).map((it) => ({
//   ...it,
//   kdsStatus: it?.kdsStatus ? String(it.kdsStatus).toUpperCase() : "PENDING",
// }));

function filterItemsForStation(items, stationKey, isStationFiltered) {
  const list = Array.isArray(items) ? items : [];
  if (!isStationFiltered) return list;

  const sk = normStationKey(stationKey);
  return list.filter((it) => normStationFromItem(it?.kdsStationKey) === sk);
}

// ==============================
// GET /api/kds/overview?branchId=BR-000004&station=BAR
// Also supports: &stationKey=BAR
// ==============================

export const getKdsOverview = async (req, res) => {
  try {
    const branchId = String(req.query.branchId || "").trim();
    if (!branchId) return res.status(400).json({ error: "Missing branchId" });

    // ✅ allow station OR stationKey
    const stationRaw =
      String(req.query.stationKey || "").trim() ||
      String(req.query.station || "").trim();

    // what client requested (for UI)
    const requestedStationKey = stationRaw ? stationRaw.toUpperCase() : "";

    // we may override this to ALL if station is view-only
    let effectiveStationKey = requestedStationKey;

    // MAIN behaves like ALL (existing behavior)
    if (
      !effectiveStationKey ||
      effectiveStationKey === "MAIN" ||
      effectiveStationKey === "ALL"
    ) {
      effectiveStationKey = "ALL";
    }

    // these are decided after branch load
    let isStationFiltered = effectiveStationKey !== "ALL";
    let isViewOnlyStation = false;

    const branch = await Branch.findOne({ branchId }).lean();
    if (!branch) return res.status(404).json({ error: "Branch not found" });

    // ✅ validate stationKey exists in branch (only if a station was requested)
    const stations = Array.isArray(branch.stations)
      ? branch.stations
      : Array.isArray(branch.kdsStations)
        ? branch.kdsStations
        : [];

    const allowed = new Set(
      stations
        .filter((s) => s && s.isEnabled !== false)
        .map((s) => normStationKey(s.key))
        .filter(Boolean),
    );

    // Always allow MAIN as fallback
    allowed.add("MAIN");

    // If caller sent a station explicitly (other than ALL/MAIN), validate it
    if (
      requestedStationKey &&
      requestedStationKey !== "ALL" &&
      requestedStationKey !== "MAIN"
    ) {
      if (!allowed.has(requestedStationKey)) {
        return res.status(400).json({
          error: "Invalid station",
          station: requestedStationKey,
          allowed: Array.from(allowed),
        });
      }

      // ✅ view-only stations should see ALL orders/items like MAIN/ALL
      const stationObj = stations.find(
        (s) => normStationKey(s?.key) === requestedStationKey,
      );

      if (stationObj && stationObj.allowOrderModification === false) {
        isViewOnlyStation = true;
        effectiveStationKey = "ALL"; // ✅ key change: do not filter items
      }
    }

    // final filtering decision
    isStationFiltered = effectiveStationKey !== "ALL";

    const tz = String(branch.timeZone || req.query.tz || "Asia/Bahrain").trim();
    const openingHours = branch.openingHours || {};

    const { startTz, endTz, label } = resolveCurrentShiftWindow({
      openingHours,
      tz,
    });

    const fromUtc = startTz.toUTC().toJSDate();
    const toUtc = endTz.toUTC().toJSDate();

    const timeQuery = {
      $or: [
        { placedAt: { $gte: fromUtc, $lt: toUtc } },
        { createdAt: { $gte: fromUtc, $lt: toUtc } },
      ],
    };

    // ======================================================
    // ✅ HELP REQUESTS (CALL WAITER)
    // ======================================================
    const helpExpireCutoff = new Date(Date.now() - 30 * 60 * 1000);
    await HelpRequest.updateMany(
      {
        branchId,
        status: "OPEN",
        createdAt: { $lte: helpExpireCutoff },
      },
      { $set: { status: "EXPIRED" } },
    );

    const helpFindQuery = {
      branchId,
      status: "OPEN",
      createdAt: { $gte: fromUtc, $lt: toUtc },
    };

    // If you later add help.stationKey, you can filter here:
    // if (isStationFiltered) helpFindQuery.stationKey = effectiveStationKey;

    const helpRequests = await HelpRequest.find(helpFindQuery)
      .sort({ lastPingAt: -1 })
      .limit(100)
      .lean();

    // ======================================================
    // ✅ AUTO SERVE: READY -> SERVED after 60s
    // ======================================================
    const now = new Date();
    const cutoff = new Date(now.getTime() - 60 * 1000);

    await Order.updateMany(
      {
        branchId,
        ...timeQuery,
        status: "Ready",
        readyAt: { $exists: true, $lte: cutoff },
      },
      {
        $set: { status: "Served", servedAt: now },
      },
    );

    // ✅ Station-scoped auto-serve ONLY when we are truly filtering by station.
    if (isStationFiltered) {
      const sk = effectiveStationKey; // ✅ use effective station key
      const toAutoServe = await Order.find({
        branchId,
        ...timeQuery,
        items: {
          $elemMatch: {
            kdsStatus: "READY",
            kdsStatusUpdatedAt: { $exists: true, $lte: cutoff },
            kdsStationKey: sk, // station-scoped auto-serve
          },
        },
      }).limit(300);

      for (const ord of toAutoServe) {
        let changed = 0;

        for (const it of ord.items || []) {
          const station = String(it?.kdsStationKey || "MAIN")
            .trim()
            .toUpperCase();
          if (station !== sk) continue;

          const code = String(it?.kdsStatus || "PENDING")
            .trim()
            .toUpperCase();
          const updatedAt = it?.kdsStatusUpdatedAt
            ? new Date(it.kdsStatusUpdatedAt)
            : null;

          if (code === "READY" && updatedAt && updatedAt <= cutoff) {
            it.kdsStatus = "SERVED";
            it.kdsStatusUpdatedAt = now;
            it.kdsStatusUpdatedBy = "AUTO_SERVE";
            changed++;
          }
        }

        if (changed > 0) {
          // Optional but recommended so devices refresh
          ord.revision = (ord.revision || 0) + 1;
          await ord.save();
        }
      }
    }

    const orders = await Order.find({
      branchId,
      ...timeQuery,
    })
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    // ✅ Build qrMap from QR collection (qrId -> {label,type,number})
    const qrIds = [
      ...new Set(
        [
          ...orders.map((o) => o?.qr?.qrId),
          ...helpRequests.map((h) => h?.qr?.qrId),
        ]
          .filter(Boolean)
          .map(String),
      ),
    ];

    let qrMap = {};
    if (qrIds.length) {
      const qrs = await Qr.find(
        { qrId: { $in: qrIds } },
        { qrId: 1, label: 1, type: 1, number: 1 },
      ).lean();

      qrMap = qrs.reduce((acc, q) => {
        acc[String(q.qrId)] = q;
        return acc;
      }, {});
    }

    // ✅ Map help requests with enriched QR info
    const helpOpen = helpRequests.map((h) => {
      const q = h.qr || {};
      const qid = q?.qrId ? String(q.qrId) : "";
      const qrDoc = qid ? qrMap[qid] : null;

      const enrichedQr = {
        qrId: q.qrId ?? null,
        label: q.label ?? (qrDoc ? qrDoc.label : null),
        type: q.type ?? (qrDoc ? qrDoc.type : null),
        number: q.number ?? (qrDoc ? qrDoc.number : null),
      };

      return {
        id: String(h._id),
        vendorId: h.vendorId ?? null,
        branchId: h.branchId ?? null,
        qr: enrichedQr,
        message: h.message ?? null,
        status: h.status,
        pingCount: h.pingCount ?? 1,
        lastPingAt: h.lastPingAt ?? h.createdAt ?? null,
        createdAt: h.createdAt ?? null,
      };
    });

    // ======================================================
    // ✅ Orders mapping (station-aware)
    // ======================================================
    const active = [];
    const completed = [];
    const cancelled = [];

    for (const o of orders) {
      const bucket = classifyStatus(o.status);

      // ✅ Backward compatibility: treat missing kdsStatus as PENDING (PER ORDER)
      const safeItems = (Array.isArray(o.items) ? o.items : []).map((it) => ({
        ...it,
        kdsStatus: it?.kdsStatus
          ? String(it.kdsStatus).toUpperCase()
          : "PENDING",
      }));

      // ✅ Enrich QR (add label even if order.qr.label is missing)
      const qr = o.qr || null;
      const qid = qr?.qrId ? String(qr.qrId) : "";
      const qrDoc = qid ? qrMap[qid] : null;

      const enrichedQr = qr
        ? {
            ...qr,
            label: qr.label ?? (qrDoc ? qrDoc.label : null),
            type: qr.type ?? (qrDoc ? qrDoc.type : null),
            number: qr.number ?? (qrDoc ? qrDoc.number : null),
          }
        : null;

      // ✅ station-filtered items (use safeItems, not o.items)
      const stationItems = filterItemsForStation(
        safeItems,
        effectiveStationKey, // ✅ IMPORTANT: use effective key (ALL for view-only)
        isStationFiltered,
      );

      // If station filter is enabled and this order has no items for that station, skip it.
      if (isStationFiltered && stationItems.length === 0) continue;

      // ✅ pricing: for station views, recompute totals from stationItems
      // NOTE: we don't mutate DB; we only mutate the response object.
      const pricingForResponse = (() => {
        if (!isStationFiltered) return o.pricing || null;
        const clone = {
          pricing: { ...(o.pricing || {}) },
          items: stationItems,
        };
        recomputeOrderPricing(clone);
        return clone.pricing;
      })();

      // ✅ stationSummary:
      // - ALL view: summary over ALL items (use safeItems so missing kdsStatus doesn't break)
      // - station view: summary over station items
      const stationSummaryForResponse = computeStationSummary(
        isStationFiltered ? stationItems : safeItems,
      );

      const mapped = {
        id: String(o._id),
        orderNumber: o.orderNumber,
        tokenNumber: o.tokenNumber ?? null,
        status: o.status || "Pending",
        branchId: o.branchId,
        currency: o.currency,

        pricing: pricingForResponse,

        qr: enrichedQr,
        customer: o.customer || null,

        // ✅ IMPORTANT: station view returns only station items
        items: stationItems,

        stationSummary: stationSummaryForResponse,

        placedAt: o.placedAt ?? null,
        createdAt: o.createdAt ?? null,
        updatedAt: o.updatedAt ?? null,
        readyAt: o.readyAt ?? null,
        servedAt: o.servedAt ?? null,
      };

      if (bucket === "active") active.push(mapped);
      else if (bucket === "completed") completed.push(mapped);
      else cancelled.push(mapped);
    }

    return res.status(200).json({
      shift: {
        tz,
        from: startTz.toISO(),
        to: endTz.toISO(),
        label,
      },

      station: {
        // show what user selected (SERVICE_STATION), but MAIN/ALL should display ALL
        key:
          requestedStationKey && requestedStationKey !== "MAIN"
            ? requestedStationKey
            : "ALL",

        // filtered means whether we filtered items by station (effective)
        filtered: isStationFiltered,

        // helpful flags for frontend
        effectiveKey: effectiveStationKey, // "ALL" for view-only stations
        viewOnly: isViewOnlyStation, // true for service station
      },

      counts: {
        active: active.length,
        completed: completed.length,
        cancelled: cancelled.length,
        total: active.length + completed.length + cancelled.length,
      },

      help: {
        openCount: helpOpen.length,
        open: helpOpen,
      },

      active,
      completed,
      cancelled,
    });
  } catch (err) {
    console.error("getKdsOverview error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};
export const updateKdsOrderStatus = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const id = String(req.params.id || "").trim();
    const incoming = String(req.body?.status || "").trim();
    const branchId = String(
      req.body?.branchId || req.query.branchId || "",
    ).trim();

    const stationRaw =
      String(req.body?.stationKey || "").trim() ||
      String(req.query.stationKey || "").trim() ||
      String(req.query.station || "").trim();

    const stationKey = stationRaw ? stationRaw.toUpperCase() : "";
    const isStationScoped =
      stationKey && stationKey !== "ALL" && stationKey !== "MAIN";

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid order id" });
    }
    if (!incoming) return res.status(400).json({ error: "Missing status" });

    const nextLabel = toLabel(incoming);
    if (!nextLabel) {
      return res.status(400).json({ error: "Invalid status value" });
    }
    const nextCode = toCode(nextLabel);

    const now = new Date();
    const userId = req.user?.uid || req.user?.email || req.user?.sub || null;

    // ------------------------------
    // helpers kept inside to avoid touching other code
    // ------------------------------
    const asInt = (v, fallback = 0) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return fallback;
      return Math.trunc(n);
    };

    const nowPlusDays = (days) => {
      const d = new Date();
      d.setDate(d.getDate() + asInt(days, 0));
      return d;
    };

    // Debit ONE order from wallet with idempotency
    async function debitWalletOnceOnMainAccept({
      branchId,
      orderId,
      orderNumber,
      actorUserId,
    }) {
      const idemKey = `ORDER_DEBIT:${orderId}`;

      // idempotency check
      const already = await BillingLedger.findOne({
        idempotencyKey: idemKey,
      }).session(session);
      if (already) {
        return { reused: true, ledger: already, wallet: null };
      }

      // fee + vendor
      const { feeFils, vendorId } = await readBranchUnitFeeFils(
        branchId,
        session,
      );
      if (feeFils <= 0) {
        throw new Error("PLATFORM_FEE_NOT_SET");
      }

      const wallet = await BranchWalletAccount.findOne({ branchId }).session(
        session,
      );
      if (!wallet) throw new Error("WALLET_NOT_FOUND");

      // block if locked and grace expired
      if (wallet.orderingLocked === true) {
        if (!wallet.graceUntil || new Date() > new Date(wallet.graceUntil)) {
          throw new Error("ORDERING_LOCKED");
        }
      }

      // exhausted => lock and block
      if (
        (wallet.totalOrdersRemaining ??
          wallet.paidOrdersRemaining + wallet.bonusOrdersRemaining) <= 0
      ) {
        if (!wallet.exhaustedAt) wallet.exhaustedAt = new Date();
        wallet.graceUntil = nowPlusDays(wallet.graceDaysAfterExhausted || 2);
        wallet.orderingLocked = true;
        wallet.lockedAt = new Date();
        await wallet.save({ session });
        throw new Error("WALLET_EXHAUSTED");
      }

      const priority = wallet.consumePriority || "bonus_first";

      if (priority === "bonus_first") {
        if (wallet.bonusOrdersRemaining > 0) {
          wallet.bonusOrdersRemaining -= 1;
        } else if (wallet.paidOrdersRemaining > 0) {
          wallet.paidOrdersRemaining -= 1;
        } else {
          throw new Error("INSUFFICIENT_ORDERS");
        }
      } else {
        if (wallet.paidOrdersRemaining > 0) {
          wallet.paidOrdersRemaining -= 1;
        } else if (wallet.bonusOrdersRemaining > 0) {
          wallet.bonusOrdersRemaining -= 1;
        } else {
          throw new Error("INSUFFICIENT_ORDERS");
        }
      }

      // lock if now exhausted
      const totalAfter =
        wallet.totalOrdersRemaining ??
        wallet.paidOrdersRemaining + wallet.bonusOrdersRemaining;
      if (totalAfter <= 0) {
        wallet.exhaustedAt = new Date();
        wallet.graceUntil = nowPlusDays(wallet.graceDaysAfterExhausted || 2);
        wallet.orderingLocked = true;
        wallet.lockedAt = new Date();
      }

      await wallet.save({ session });

      const ledgerId = await generateLedgerId();

      const led = await BillingLedger.create(
        [
          {
            ledgerId,
            branchId,
            vendorId,
            actorUserId: actorUserId || "",
            actorRole: "system",
            entryType: "ORDER_DEBIT",
            direction: "DEBIT",
            amountFils: feeFils,
            currency: "BHD",
            unitFeeFils: feeFils,
            ordersDebited: 1,
            orderId,
            orderNumber: orderNumber || "",
            status: "succeeded",
            idempotencyKey: idemKey,
            payment: {
              provider: "",
              status: "",
              transactionId: "",
              merchantReference: "",
              authCode: "",
              resultCode: "",
              paidAt: null,
              raw: null,
            },
            snapshotAfter: {
              paidOrdersRemaining: wallet.paidOrdersRemaining,
              bonusOrdersRemaining: wallet.bonusOrdersRemaining,
              totalOrdersRemaining: wallet.totalOrdersRemaining,
            },
            title: "Order fee deducted on accept (MAIN)",
            note: `Deducted 1 order at fee=${feeFils} fils (priority=${priority})`,
          },
        ],
        { session },
      );

      return { reused: false, wallet, ledger: led[0] };
    }

    // ------------------------------
    // Transaction: update + maybe debit
    // ------------------------------
    let responsePayload = null;

    await session.withTransaction(async () => {
      const order = await Order.findById(id).session(session);
      if (!order) {
        responsePayload = { code: 404, body: { error: "Order not found" } };
        return;
      }

      if (branchId && String(order.branchId || "") !== branchId) {
        responsePayload = { code: 403, body: { error: "Branch mismatch" } };
        return;
      }

      // block terminal orders
      const curOrder = String(order.status || "").toLowerCase();
      if (
        ["completed", "cancelled", "canceled", "rejected"].includes(curOrder)
      ) {
        responsePayload = {
          code: 409,
          body: { error: "Order is terminal; cannot update" },
        };
        return;
      }

      // ✅ track BEFORE derived status (this is how we detect MAIN accept)
      const beforeDerivedLabel = deriveOrderStatusFromLines(order.items || []);
      const beforeDerivedCode = toCode(beforeDerivedLabel);

      // ✅ choose which lines this request can modify
      const allItems = Array.isArray(order.items) ? order.items : [];
      const targetItems = isStationScoped
        ? allItems.filter(
            (it) => normStationFromItem(it?.kdsStationKey) === stationKey,
          )
        : allItems;

      if (isStationScoped && targetItems.length === 0) {
        responsePayload = {
          code: 409,
          body: {
            error: "No items for this station in the order",
            stationKey,
          },
        };
        return;
      }

      // ✅ apply per-line transition
      let changedCount = 0;

      for (const it of targetItems) {
        const curLineCode = normLineStatus(it?.kdsStatus);
        const curLineLabel = toLabel(curLineCode) || "Pending";

        if (canTransition(curLineLabel, nextLabel)) {
          const before = normLineStatus(it.kdsStatus);
          it.kdsStatus = nextCode;
          it.kdsStatusUpdatedAt = now;
          it.kdsStatusUpdatedBy = userId;

          if (before !== nextCode) changedCount++;
        }
      }

      if (changedCount === 0) {
        responsePayload = {
          code: 409,
          body: {
            error:
              "No line items were updated (transition blocked or already same status)",
            stationKey: isStationScoped ? stationKey : "ALL",
            to: nextLabel,
          },
        };
        return;
      }

      // ✅ derive order.status from line statuses
      const derivedLabel = deriveOrderStatusFromLines(order.items || []);
      const derivedCode = toCode(derivedLabel);

      order.status = derivedLabel;

      if (derivedCode === "READY") {
        if (!order.readyAt) order.readyAt = now;
      }
      if (derivedCode === "SERVED") {
        if (!order.servedAt) order.servedAt = now;
      }

      // ✅ save order first (inside txn)
      await order.save({ session });

      // ======================================================
      // ✅ DEBIT ONLY WHEN MAIN ACCEPTS (GLOBAL) THE ORDER
      // Condition: global action + derived moves PENDING -> PREPARING
      // ======================================================
      const isMainGlobalAction = !isStationScoped; // stationKey missing/ALL/MAIN
      const isAcceptMoment =
        beforeDerivedCode === "PENDING" && derivedCode === "PREPARING";

      if (isMainGlobalAction && isAcceptMoment) {
        // debit once for the whole order
        await debitWalletOnceOnMainAccept({
          branchId: String(order.branchId || branchId || "").trim(),
          orderId: String(order._id),
          orderNumber: String(order.orderNumber || ""),
          actorUserId: userId,
        });
      }

      // keep SAME response shape you had before
      responsePayload = {
        code: 200,
        body: {
          message: "Line status updated",
          scope: isStationScoped ? { stationKey } : { stationKey: "ALL" },
          changedCount,
          order: {
            id: String(order._id),
            status: order.status,
            readyAt: order.readyAt ?? null,
            servedAt: order.servedAt ?? null,
            updatedAt: order.updatedAt ?? null,
            revision: order.revision ?? 0,
          },
        },
      };
    });

    if (!responsePayload) {
      return res.status(500).json({ error: "Server error" });
    }

    if (responsePayload.code === 200 && responsePayload.body?.order?.id) {
      try {
        const order = await Order.findById(
          responsePayload.body.order.id,
        ).lean();

        if (order) {
          await publishOrderFanout({
            branchId: order.branchId,
            eventName: "order.updated",
            payload: {
              type: "order.updated",
              updateType: "status",
              branchId: order.branchId,
              orderId: String(order._id),
              tokenNumber: order.tokenNumber ?? null,
              revision: order.revision ?? 0,
              status: order.status,
            },
            items: order.items || [],
          });
        }
      } catch (e) {
        console.error("Ably publish after updateKdsOrderStatus failed:", e);
      }
    }

    return res.status(responsePayload.code).json(responsePayload.body);
  } catch (err) {
    const msg = String(err?.message || err);

    // Keep it simple & predictable
    const map = {
      WALLET_NOT_FOUND: 403,
      ORDERING_LOCKED: 403,
      WALLET_EXHAUSTED: 403,
      PLATFORM_FEE_NOT_SET: 400,
      INSUFFICIENT_ORDERS: 403,
      BRANCH_NOT_FOUND: 404,
    };

    const code = map[msg] || 500;
    return res.status(code).json({ error: msg || "Server error" });
  } finally {
    session.endSession();
  }
};

// export const updateKdsOrderStatus = async (req, res) => {
//   try {
//     const id = String(req.params.id || "").trim();
//     const incoming = String(req.body?.status || "").trim();
//     const branchId = String(
//       req.body?.branchId || req.query.branchId || "",
//     ).trim();

//     const stationRaw =
//       String(req.body?.stationKey || "").trim() ||
//       String(req.query.stationKey || "").trim() ||
//       String(req.query.station || "").trim();

//     const stationKey = stationRaw ? stationRaw.toUpperCase() : "";
//     const isStationScoped =
//       stationKey && stationKey !== "ALL" && stationKey !== "MAIN";

//     if (!mongoose.Types.ObjectId.isValid(id)) {
//       return res.status(400).json({ error: "Invalid order id" });
//     }
//     if (!incoming) return res.status(400).json({ error: "Missing status" });

//     const nextLabel = toLabel(incoming);
//     if (!nextLabel) {
//       return res.status(400).json({ error: "Invalid status value" });
//     }
//     const nextCode = toCode(nextLabel); // PREPARING/READY/...

//     const order = await Order.findById(id);
//     if (!order) return res.status(404).json({ error: "Order not found" });

//     if (branchId && String(order.branchId || "") !== branchId) {
//       return res.status(403).json({ error: "Branch mismatch" });
//     }

//     // block terminal orders
//     const curOrder = String(order.status || "").toLowerCase();
//     if (["completed", "cancelled", "canceled", "rejected"].includes(curOrder)) {
//       return res
//         .status(409)
//         .json({ error: "Order is terminal; cannot update" });
//     }

//     const now = new Date();
//     const userId = req.user?.uid || req.user?.email || req.user?.sub || null;

//     // ✅ choose which lines this request is allowed to modify
//     const allItems = Array.isArray(order.items) ? order.items : [];
//     const targetItems = isStationScoped
//       ? allItems.filter(
//           (it) => normStationFromItem(it?.kdsStationKey) === stationKey,
//         )
//       : allItems;

//     if (isStationScoped && targetItems.length === 0) {
//       return res.status(409).json({
//         error: "No items for this station in the order",
//         stationKey,
//       });
//     }

//     // ✅ apply transition per-line (not whole order)
//     let changedCount = 0;

//     for (const it of targetItems) {
//       // treat missing kdsStatus as PENDING (backward compatible)
//       const curLineCode = normLineStatus(it?.kdsStatus);
//       const curLineLabel = toLabel(curLineCode) || "Pending";

//       // allow idempotent, and validate transition per item
//       if (canTransition(curLineLabel, nextLabel)) {
//         const before = normLineStatus(it.kdsStatus);
//         it.kdsStatus = nextCode;
//         it.kdsStatusUpdatedAt = now;
//         it.kdsStatusUpdatedBy = userId;

//         if (before !== nextCode) changedCount++;
//       }
//     }

//     if (changedCount === 0) {
//       return res.status(409).json({
//         error:
//           "No line items were updated (transition blocked or already same status)",
//         stationKey: isStationScoped ? stationKey : "ALL",
//         to: nextLabel,
//       });
//     }

//     // ✅ derive order.status from line statuses (so customer/admin stays correct)
//     const derivedLabel = deriveOrderStatusFromLines(order.items || []);
//     const derivedCode = toCode(derivedLabel);

//     // keep your existing timestamps logic BUT only when derived status reaches those stages
//     order.status = derivedLabel;

//     if (derivedCode === "READY") {
//       if (!order.readyAt) order.readyAt = now;
//     }

//     if (derivedCode === "SERVED") {
//       if (!order.servedAt) order.servedAt = now;
//     }

//     // optional: bump revision so KDS devices refresh attention, but NOT required
//     // order.revision = (order.revision || 0) + 1;

//     await order.save();

//     return res.status(200).json({
//       message: "Line status updated",
//       scope: isStationScoped ? { stationKey } : { stationKey: "ALL" },
//       changedCount,
//       order: {
//         id: String(order._id),
//         status: order.status,
//         readyAt: order.readyAt ?? null,
//         servedAt: order.servedAt ?? null,
//         updatedAt: order.updatedAt ?? null,
//         revision: order.revision ?? 0,
//       },
//     });
//   } catch (err) {
//     console.error("updateKdsOrderStatus error:", err);
//     return res.status(500).json({ error: err.message || "Server error" });
//   }
// };

// --------------------------
// Helpers for per-line status
// --------------------------
function normLineStatus(v) {
  const s = String(v || "")
    .trim()
    .toUpperCase();
  return s || "PENDING";
}

/**
 * ✅ Derive the order-level label from line statuses.
 * Logic:
 * - Ignore cancelled/rejected lines when calculating progress (unless all lines are cancelled/rejected)
 * - If any active line pending -> Pending
 * - Else if any active line preparing -> Preparing
 * - Else if any active line ready -> Ready
 * - Else if any active line served -> Served
 * - Else -> Completed
 */
function deriveOrderStatusFromLines(items) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return "Pending";

  const codes = list.map((it) => normLineStatus(it?.kdsStatus));

  const isLineTerminal = (c) => ["CANCELLED", "REJECTED"].includes(c);

  const active = codes.filter((c) => !isLineTerminal(c));

  // if all lines terminal
  if (active.length === 0) {
    const allRejected = codes.every((c) => c === "REJECTED");
    return allRejected ? "Rejected" : "Cancelled";
  }

  const rank = (c) => {
    switch (c) {
      case "PENDING":
        return 1;
      case "PREPARING":
        return 2;
      case "READY":
        return 3;
      case "SERVED":
        return 4;
      case "COMPLETED":
        return 5;
      default:
        return 1;
    }
  };

  // choose minimum progress among active lines (so order stays pending until all accepted)
  let min = 99;
  for (const c of active) min = Math.min(min, rank(c));

  if (min === 1) return "Pending";
  if (min === 2) return "Preparing";
  if (min === 3) return "Ready";
  if (min === 4) return "Served";
  return "Completed";
}

// export const updateKdsOrderStatus = async (req, res) => {
//   try {
//     const id = String(req.params.id || "").trim();
//     const incoming = String(req.body?.status || "").trim();

//     if (!mongoose.Types.ObjectId.isValid(id)) {
//       return res.status(400).json({ error: "Invalid order id" });
//     }
//     if (!incoming) return res.status(400).json({ error: "Missing status" });

//     const branchId = String(
//       req.body?.branchId || req.query.branchId || "",
//     ).trim();

//     const nextStatusLabel = toLabel(incoming);
//     if (!nextStatusLabel) {
//       return res.status(400).json({ error: "Invalid status value" });
//     }

//     const order = await Order.findById(id);
//     if (!order) return res.status(404).json({ error: "Order not found" });

//     if (branchId && String(order.branchId || "") !== branchId) {
//       return res.status(403).json({ error: "Branch mismatch" });
//     }

//     const currentLabel = String(order.status || "Pending").trim();

//     // ✅ transition rules
//     if (!canTransition(currentLabel, nextStatusLabel)) {
//       return res.status(409).json({
//         error: "Invalid status transition",
//         from: currentLabel,
//         to: nextStatusLabel,
//       });
//     }

//     // ✅ If moving to READY, stamp readyAt
//     const nextCode = toCode(nextStatusLabel);
//     const now = new Date();

//     order.status = nextStatusLabel;

//     if (nextCode === "READY") {
//       if (!order.readyAt) order.readyAt = now;
//     }

//     if (nextCode === "SERVED") {
//       if (!order.servedAt) order.servedAt = now;
//     }

//     await order.save();

//     return res.status(200).json({
//       message: "Status updated",
//       order: {
//         id: String(order._id),
//         status: order.status,
//         readyAt: order.readyAt ?? null,
//         servedAt: order.servedAt ?? null,
//         updatedAt: order.updatedAt ?? null,
//       },
//     });
//   } catch (err) {
//     console.error("updateKdsOrderStatus error:", err);
//     return res.status(500).json({ error: err.message || "Server error" });
//   }
// };

/**
 * PATCH /api/kds/orders/:id/items/:lineId/availability
 * Body: { availability: "OUT_OF_STOCK" | "AVAILABLE", reason?: string, branchId?: string }
 */
export const updateKdsOrderItemAvailability = async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const lineId = String(req.params.lineId || "").trim();

    const availability = String(req.body?.availability || "")
      .trim()
      .toUpperCase();
    const reason = String(req.body?.reason || "").trim();
    const branchId = String(
      req.body?.branchId || req.query.branchId || "",
    ).trim();

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid order id" });
    }
    if (!mongoose.Types.ObjectId.isValid(lineId)) {
      return res.status(400).json({ error: "Invalid line id" });
    }
    if (!["AVAILABLE", "OUT_OF_STOCK"].includes(availability)) {
      return res.status(400).json({ error: "Invalid availability value" });
    }

    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ error: "Order not found" });

    if (branchId && String(order.branchId || "") !== branchId) {
      return res.status(403).json({ error: "Branch mismatch" });
    }

    // block terminal orders
    const cur = String(order.status || "").toLowerCase();
    if (["completed", "cancelled", "canceled", "rejected"].includes(cur)) {
      return res
        .status(409)
        .json({ error: "Order is terminal; cannot amend items" });
    }

    const it = order.items?.id(lineId);
    if (!it) return res.status(404).json({ error: "Line item not found" });

    const now = new Date();
    const userId = req.user?.uid || req.user?.email || req.user?.sub || null;

    if (availability === "OUT_OF_STOCK") {
      it.availability = "OUT_OF_STOCK";
      it.unavailableReason = reason || it.unavailableReason || "Out of stock";
      it.unavailableAt = now;
      it.unavailableBy = userId;
    } else {
      it.availability = "AVAILABLE";
      it.unavailableReason = null;
      it.unavailableAt = null;
      it.unavailableBy = null;
    }

    // ✅ bump revision so customer + KDS can detect amendments
    order.revision = (order.revision || 0) + 1;

    // ✅ optional lastChange for customer UI
    order.lastChange = {
      type: "ITEM_OUT_OF_STOCK",
      at: now,
      by: userId,
      payload: {
        lineId,
        availability,
        reason:
          availability === "OUT_OF_STOCK"
            ? it.unavailableReason || reason || null
            : null,
      },
    };

    // ✅ recompute totals automatically (AVAILABLE lines only)
    recomputeOrderPricing(order);

    await order.save();

    await publishOrderFanout({
      branchId: order.branchId,
      eventName: "order.updated",
      payload: {
        type: "order.updated",
        updateType: "availability",
        branchId: order.branchId,
        orderId: String(order._id),
        tokenNumber: order.tokenNumber ?? null,
        revision: order.revision ?? 0,
        status: order.status,
      },
      items: order.items || [],
    });

    return res.status(200).json({
      ok: true,
      message: "Item availability updated",
      order: {
        id: String(order._id),
        revision: order.revision,
        status: order.status,
        pricing: order.pricing,
        lastChange: order.lastChange || null,
        items: order.items,
        updatedAt: order.updatedAt ?? null,
      },
    });
  } catch (err) {
    console.error("updateKdsOrderItemAvailability error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};

/**
 * PATCH /api/kds/help/:id/ack
 * Body: { branchId: "BR-000004" }
 * Protected by verifyFirebaseToken (route-level)
 */
export const ackHelpRequest = async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const branchId = String(
      req.body?.branchId || req.query.branchId || "",
    ).trim();

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid help id" });
    }
    if (!branchId) return res.status(400).json({ error: "Missing branchId" });

    const help = await HelpRequest.findById(id);
    if (!help) return res.status(404).json({ error: "Help request not found" });

    if (String(help.branchId || "") !== branchId) {
      return res.status(403).json({ error: "Branch mismatch" });
    }

    // idempotent
    if (String(help.status || "") !== "OPEN") {
      return res.status(200).json({
        ok: true,
        message: "Help request already closed",
        help: { id: String(help._id), status: help.status },
      });
    }

    help.status = "ACK";
    help.ackAt = new Date();
    help.ackBy = req.user?.uid || req.user?.email || req.user?.sub || null;

    await help.save();

    await publishEvent(branchChannel(branchId), "help.updated", {
      type: "help.updated",
      updateType: "ack",
      branchId,
      helpId: String(help._id),
      status: help.status,
    });

    return res.status(200).json({
      ok: true,
      message: "Help request acknowledged",
      help: {
        id: String(help._id),
        status: help.status,
        ackAt: help.ackAt,
        ackBy: help.ackBy ?? null,
      },
    });
  } catch (err) {
    console.error("ackHelpRequest error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};

// ==============================
// GET /api/kds/stations?branchId=BR-000005
// ==============================
export const getKdsStations = async (req, res) => {
  try {
    const branchId = String(req.query.branchId || "").trim();
    if (!branchId) return res.status(400).json({ error: "Missing branchId" });

    const branch = await Branch.findOne({ branchId }).lean();
    if (!branch) return res.status(404).json({ error: "Branch not found" });

    const stationsRaw = Array.isArray(branch.stations)
      ? branch.stations
      : Array.isArray(branch.kdsStations)
        ? branch.kdsStations
        : [];

    const stations = stationsRaw
      .filter((s) => s && s.isEnabled !== false)
      .map((s) => ({
        stationId: s.stationId ?? null,
        key: normStationKey(s.key),
        nameEnglish: String(
          s.nameEnglish || s.name || s.label || s.key || "",
        ).trim(),
        nameArabic: String(s.nameArabic || "").trim(),
        sortOrder: Number.isFinite(Number(s.sortOrder))
          ? Number(s.sortOrder)
          : 0,
        hasPin: !!String(s.pinHash || "").trim(),
        allowOrderModification: s.allowOrderModification !== false,
      }))
      .filter((s) => s.key)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    return res.status(200).json({
      ok: true,
      branchId,
      stations,
    });
  } catch (err) {
    console.error("getKdsStations error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};

// ==============================
// POST /api/kds/stations/login
// Body: { branchId, stationKey, pin }
// ==============================
export const loginKdsStation = async (req, res) => {
  try {
    const branchId = String(req.body?.branchId || "").trim();
    const stationKey = normStationKey(req.body?.stationKey);
    const pin = String(req.body?.pin || "").trim(); // may be empty for MAIN

    if (!branchId) return res.status(400).json({ error: "Missing branchId" });
    if (!stationKey)
      return res.status(400).json({ error: "Missing stationKey" });

    const branch = await Branch.findOne({ branchId });
    if (!branch) return res.status(404).json({ error: "Branch not found" });

    const stationsRaw = Array.isArray(branch.stations)
      ? branch.stations
      : Array.isArray(branch.kdsStations)
        ? branch.kdsStations
        : [];

    const idx = stationsRaw.findIndex(
      (s) => normStationKey(s?.key) === stationKey && s?.isEnabled !== false,
    );

    if (idx < 0) {
      return res.status(400).json({ error: "Invalid station", stationKey });
    }

    const st = stationsRaw[idx];

    // ✅ MAIN: no PIN required (ignore whatever user sends)
    if (stationKey === "MAIN") {
      return res.status(200).json({
        ok: true,
        branchId,
        station: {
          stationId: st.stationId ?? null,
          key: stationKey,
          nameEnglish: st.nameEnglish || "Main",
          nameArabic: st.nameArabic || "",
          allowOrderModification: st.allowOrderModification !== false,
        },
      });
    }

    // ✅ For others: require pinHash + bcrypt compare
    const hash = String(st.pinHash || "").trim();
    if (!hash) {
      return res.status(409).json({ error: "Station PIN not configured" });
    }
    if (!pin) {
      return res.status(400).json({ error: "Missing pin" });
    }

    // Optional lock check (your schema has pinLockUntil)
    const lockUntil = st.pinLockUntil ? new Date(st.pinLockUntil) : null;
    if (lockUntil && lockUntil > new Date()) {
      return res.status(423).json({
        error: "Station locked",
        lockUntil,
      });
    }

    const ok = await bcrypt.compare(pin, hash);

    if (!ok) {
      st.pinFailedCount = (st.pinFailedCount || 0) + 1;

      // optional: lock after 5 failures for 5 minutes
      if (st.pinFailedCount >= 5) {
        st.pinLockUntil = new Date(Date.now() + 5 * 60 * 1000);
        st.pinFailedCount = 0;
      }

      await branch.save();
      return res.status(401).json({ error: "Invalid PIN" });
    }

    // ✅ reset counters on success
    st.pinFailedCount = 0;
    st.pinLockUntil = null;
    await branch.save();

    return res.status(200).json({
      ok: true,
      branchId,
      station: {
        stationId: st.stationId ?? null,
        key: stationKey,
        nameEnglish: st.nameEnglish || st.name || st.label || stationKey,
        nameArabic: st.nameArabic || "",
        allowOrderModification: st.allowOrderModification !== false,
      },
    });
  } catch (err) {
    console.error("loginKdsStation error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};

// // src/controllers/kdsController.js
// import { DateTime } from "luxon";
// import mongoose from "mongoose";
// import Branch from "../models/Branch.js";
// import Order from "../models/Order.js";
// import Qr from "../models/QrCodeOrders.js"; // ✅ or whatever your QR model file is called
// import HelpRequest from "../models/HelpRequest.js";
// import bcrypt from "bcryptjs";

// const DAY_KEYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// function parseRange(rangeStr) {
//   const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(
//     String(rangeStr || "").trim(),
//   );
//   if (!m) return null;
//   return {
//     startH: Number(m[1]),
//     startM: Number(m[2]),
//     endH: Number(m[3]),
//     endM: Number(m[4]),
//   };
// }

// function buildShiftWindowForDay(baseDate, range, tz) {
//   const start = baseDate.set({
//     hour: range.startH,
//     minute: range.startM,
//     second: 0,
//     millisecond: 0,
//   });
//   let end = baseDate.set({
//     hour: range.endH,
//     minute: range.endM,
//     second: 0,
//     millisecond: 0,
//   });
//   if (end <= start) end = end.plus({ days: 1 });
//   return { start, end };
// }

// function getDayKey(dt) {
//   return DAY_KEYS[dt.weekday - 1];
// }

// function resolveCurrentShiftWindow({ openingHours, tz, now }) {
//   const nowTz = now ? now.setZone(tz) : DateTime.now().setZone(tz);

//   const todayKey = getDayKey(nowTz);
//   const todayRange = parseRange(openingHours?.[todayKey]);

//   const todayBase = nowTz.startOf("day");
//   const todayWindow = todayRange
//     ? buildShiftWindowForDay(todayBase, todayRange, tz)
//     : null;

//   const yTz = nowTz.minus({ days: 1 });
//   const yKey = getDayKey(yTz);
//   const yRange = parseRange(openingHours?.[yKey]);
//   const yBase = yTz.startOf("day");
//   const yWindow = yRange ? buildShiftWindowForDay(yBase, yRange, tz) : null;

//   if (yWindow && nowTz >= yWindow.start && nowTz < yWindow.end) {
//     return {
//       startTz: yWindow.start,
//       endTz: yWindow.end,
//       label: `${yKey} ${yWindow.start.toFormat("HH:mm")} → ${getDayKey(
//         yWindow.end,
//       )} ${yWindow.end.toFormat("HH:mm")}`,
//     };
//   }

//   if (todayWindow) {
//     return {
//       startTz: todayWindow.start,
//       endTz: todayWindow.end,
//       label: `${todayKey} ${todayWindow.start.toFormat("HH:mm")} → ${getDayKey(
//         todayWindow.end,
//       )} ${todayWindow.end.toFormat("HH:mm")}`,
//     };
//   }

//   const start = nowTz.startOf("day");
//   const end = start.plus({ days: 1 });
//   return {
//     startTz: start,
//     endTz: end,
//     label: `${todayKey} ${start.toFormat("HH:mm")} → ${getDayKey(end)} ${end.toFormat(
//       "HH:mm",
//     )}`,
//   };
// }

// function normalizeStatus(s) {
//   return String(s || "")
//     .trim()
//     .toLowerCase();
// }

// function classifyStatus(raw) {
//   const s = normalizeStatus(raw);

//   // ✅ Active tab should include your kitchen flow
//   if (["pending", "accepted", "preparing", "ready"].includes(s))
//     return "active";

//   // ✅ Completed tab
//   if (["served", "completed", "paid", "closed", "delivered"].includes(s))
//     return "completed";

//   // ✅ Cancelled tab
//   if (["cancelled", "canceled", "void", "rejected"].includes(s))
//     return "cancelled";

//   return "active";
// }

// function num(v, d = 0) {
//   const n = typeof v === "number" ? v : Number(v);
//   return Number.isFinite(n) ? n : d;
// }

// function lineTotalOf(it) {
//   const qty = Math.max(1, Math.trunc(num(it.quantity, 1)));
//   // Prefer stored lineTotal
//   const lt = num(it.lineTotal, NaN);
//   if (Number.isFinite(lt)) return lt;

//   // Fallback: assume unitBasePrice is final per-unit price
//   const unit = num(it.unitBasePrice, 0);
//   return unit * qty;
// }

// function recomputeOrderPricing(order) {
//   const pricing = order.pricing || {};

//   const vatPercent = num(pricing.vatPercent, 0);
//   const scPercent = num(pricing.serviceChargePercent, 0);
//   const isVatInclusive = !!pricing.isVatInclusive;

//   // ✅ Subtotal = sum of AVAILABLE lines only
//   const subtotal = (order.items || [])
//     .filter((it) => String(it.availability || "AVAILABLE") !== "OUT_OF_STOCK")
//     .reduce((acc, it) => acc + lineTotalOf(it), 0);

//   // We compute using a consistent model:
//   // - If VAT inclusive: extract net from subtotal, then compute SC on net, then VAT on (net + SC)
//   // - If VAT exclusive: net = subtotal, SC on net, VAT on (net + SC)
//   const vatRate = vatPercent / 100;
//   const scRate = scPercent / 100;

//   const net =
//     isVatInclusive && vatRate > 0 ? subtotal / (1 + vatRate) : subtotal;
//   const serviceChargeAmount = net * scRate;

//   const taxable = net + serviceChargeAmount;
//   const vatAmount = vatRate > 0 ? taxable * vatRate : 0;

//   const grandTotal = taxable + vatAmount;

//   order.pricing = {
//     ...pricing,
//     subtotal,
//     subtotalExVat: net,
//     serviceChargeAmount,
//     vatAmount,
//     grandTotal,
//   };
// }

// // ---------- helpers for status parsing ----------
// const STATUS_CODE_TO_LABEL = {
//   PENDING: "Pending",
//   ACCEPTED: "Accepted",
//   PREPARING: "Preparing",
//   READY: "Ready",
//   SERVED: "Served",
//   COMPLETED: "Completed",
//   CANCELLED: "Cancelled",
//   REJECTED: "Rejected",
// };

// const toCode = (s) =>
//   String(s || "")
//     .trim()
//     .toUpperCase()
//     .replace(/\s+/g, "_");

// const toLabel = (incoming) => {
//   const code = toCode(incoming);
//   if (STATUS_CODE_TO_LABEL[code]) return STATUS_CODE_TO_LABEL[code];

//   // try match by label value
//   const found = Object.values(STATUS_CODE_TO_LABEL).find(
//     (lbl) => toCode(lbl) === code,
//   );
//   return found || null;
// };

// const isTerminal = (label) => {
//   const s = normalizeStatus(label);
//   return ["completed", "cancelled", "canceled", "rejected"].includes(s);
// };

// function canTransition(currentLabel, nextLabel) {
//   const cur = toCode(currentLabel); // works for label too
//   const nxt = toCode(nextLabel);

//   // allow same status (idempotent)
//   if (cur === nxt) return true;

//   // Terminal cannot move
//   if (isTerminal(currentLabel)) return false;

//   // Define allowed moves
//   const rules = {
//     PENDING: new Set(["PREPARING", "REJECTED", "CANCELLED"]),
//     ACCEPTED: new Set(["PREPARING", "CANCELLED"]),
//     PREPARING: new Set(["READY", "CANCELLED"]),
//     READY: new Set(["SERVED"]), // you can keep manual serve allowed, but mostly auto
//     SERVED: new Set(["COMPLETED"]),
//     // COMPLETED/CANCELLED/REJECTED are terminal handled above
//   };

//   const allowed = rules[cur];
//   if (!allowed) return false;
//   return allowed.has(nxt);
// }

// /**
//  * GET /api/kds/overview?branchId=BR-000004&station=BAR
//  *
//  * ✅ NEW:
//  * - Optional filter: station (KDS station key)
//  * - Response becomes station-aware:
//  *   - help.open is filtered to station (if help has stationKey in schema)
//  *   - orders are filtered so each station sees ONLY its items
//  *   - each order returns:
//  *       items: ONLY items for that station
//  *       stationSummary: per-station breakdown (optional)
//  *
//  * Notes:
//  * - If station is not provided (or "ALL"), behavior is backward compatible (returns full orders).
//  * - We normalize station key with trim().toUpperCase().
//  */
// export const getKdsOverview = async (req, res) => {
//   try {
//     const branchId = String(req.query.branchId || "").trim();
//     if (!branchId) return res.status(400).json({ error: "Missing branchId" });

//     // ✅ optional station filter
//     const stationRaw = String(req.query.station || "").trim();
//     const stationKey = stationRaw ? stationRaw.toUpperCase() : ""; // "" => all
//     // const isStationFiltered = stationKey.isNotEmpty && stationKey !== "ALL";
//     const isStationFiltered = stationKey.length > 0 && stationKey !== "ALL";

//     const branch = await Branch.findOne({ branchId }).lean();
//     if (!branch) return res.status(404).json({ error: "Branch not found" });

//     // ✅ validate stationKey exists in branch (only if station filter is used)
//     if (isStationFiltered) {
//       const stations = Array.isArray(branch.stations)
//         ? branch.stations
//         : Array.isArray(branch.kdsStations)
//           ? branch.kdsStations
//           : [];
//       const allowed = new Set(
//         stations
//           .filter((s) => s && s.isEnabled !== false)
//           .map((s) =>
//             String(s.key || "")
//               .trim()
//               .toUpperCase(),
//           )
//           .filter(Boolean),
//       );
//       // Always allow MAIN as fallback
//       allowed.add("MAIN");

//       if (!allowed.has(stationKey)) {
//         return res.status(400).json({
//           error: "Invalid station",
//           station: stationKey,
//           allowed: Array.from(allowed),
//         });
//       }
//     }

//     const tz = String(branch.timeZone || req.query.tz || "Asia/Bahrain").trim();
//     const openingHours = branch.openingHours || {};

//     const { startTz, endTz, label } = resolveCurrentShiftWindow({
//       openingHours,
//       tz,
//     });

//     const fromUtc = startTz.toUTC().toJSDate();
//     const toUtc = endTz.toUTC().toJSDate();

//     const timeQuery = {
//       $or: [
//         { placedAt: { $gte: fromUtc, $lt: toUtc } },
//         { createdAt: { $gte: fromUtc, $lt: toUtc } },
//       ],
//     };

//     // ======================================================
//     // ✅ HELP REQUESTS (CALL WAITER)
//     // ======================================================
//     const helpExpireCutoff = new Date(Date.now() - 30 * 60 * 1000);
//     await HelpRequest.updateMany(
//       {
//         branchId,
//         status: "OPEN",
//         createdAt: { $lte: helpExpireCutoff },
//       },
//       { $set: { status: "EXPIRED" } },
//     );

//     // ✅ if you later add help.stationKey, you can filter here too
//     const helpFindQuery = {
//       branchId,
//       status: "OPEN",
//       createdAt: { $gte: fromUtc, $lt: toUtc },
//     };

//     // If your HelpRequest schema has stationKey, enable this:
//     // if (isStationFiltered) helpFindQuery.stationKey = stationKey;

//     const helpRequests = await HelpRequest.find(helpFindQuery)
//       .sort({ lastPingAt: -1 })
//       .limit(100)
//       .lean();

//     // ======================================================
//     // ✅ AUTO SERVE: READY -> SERVED after 60s
//     // ======================================================
//     const now = new Date();
//     const cutoff = new Date(now.getTime() - 60 * 1000);

//     await Order.updateMany(
//       {
//         branchId,
//         ...timeQuery,
//         status: "Ready",
//         readyAt: { $exists: true, $lte: cutoff },
//       },
//       {
//         $set: { status: "Served", servedAt: now },
//       },
//     );

//     const orders = await Order.find({
//       branchId,
//       ...timeQuery,
//     })
//       .sort({ createdAt: -1 })
//       .limit(500)
//       .lean();

//     // ✅ Build qrMap from QR collection (qrId -> {label,type,number})
//     const qrIds = [
//       ...new Set(
//         [
//           ...orders.map((o) => o?.qr?.qrId),
//           ...helpRequests.map((h) => h?.qr?.qrId),
//         ]
//           .filter(Boolean)
//           .map(String),
//       ),
//     ];

//     let qrMap = {};
//     if (qrIds.length) {
//       const qrs = await Qr.find(
//         { qrId: { $in: qrIds } },
//         { qrId: 1, label: 1, type: 1, number: 1 },
//       ).lean();

//       qrMap = qrs.reduce((acc, q) => {
//         acc[String(q.qrId)] = q;
//         return acc;
//       }, {});
//     }

//     // ✅ Map help requests with enriched QR info
//     const helpOpen = helpRequests.map((h) => {
//       const q = h.qr || {};
//       const qid = q?.qrId ? String(q.qrId) : "";
//       const qrDoc = qid ? qrMap[qid] : null;

//       const enrichedQr = {
//         qrId: q.qrId ?? null,
//         label: q.label ?? (qrDoc ? qrDoc.label : null),
//         type: q.type ?? (qrDoc ? qrDoc.type : null),
//         number: q.number ?? (qrDoc ? qrDoc.number : null),
//       };

//       return {
//         id: String(h._id),
//         vendorId: h.vendorId ?? null,
//         branchId: h.branchId ?? null,
//         qr: enrichedQr,
//         message: h.message ?? null,
//         status: h.status,
//         pingCount: h.pingCount ?? 1,
//         lastPingAt: h.lastPingAt ?? h.createdAt ?? null,
//         createdAt: h.createdAt ?? null,

//         // If schema has stationKey, also return it
//         // stationKey: h.stationKey ?? null,
//       };
//     });

//     // ======================================================
//     // ✅ Station-aware order mapping
//     // ======================================================

//     const normStation = (v) => {
//       const s = String(v ?? "").trim();
//       return s ? s.toUpperCase() : "MAIN";
//     };

//     const filterItemsForStation = (items) => {
//       const list = Array.isArray(items) ? items : [];
//       if (!isStationFiltered) return list;

//       return list.filter((it) => normStation(it?.kdsStationKey) === stationKey);
//     };

//     const computeStationSummary = (items) => {
//       const list = Array.isArray(items) ? items : [];
//       const map = new Map(); // key -> {count, qty}
//       for (const it of list) {
//         const k = normStation(it?.kdsStationKey);
//         const qty = Math.max(1, parseInt(it?.quantity ?? 1, 10) || 1);
//         const cur = map.get(k) || { itemCount: 0, qtyTotal: 0 };
//         cur.itemCount += 1;
//         cur.qtyTotal += qty;
//         map.set(k, cur);
//       }
//       return Array.from(map.entries()).map(([k, v]) => ({
//         stationKey: k,
//         itemCount: v.itemCount,
//         qtyTotal: v.qtyTotal,
//       }));
//     };

//     const active = [];
//     const completed = [];
//     const cancelled = [];

//     for (const o of orders) {
//       const bucket = classifyStatus(o.status);

//       // ✅ Enrich QR (add label even if order.qr.label is missing)
//       const qr = o.qr || null;
//       const qid = qr?.qrId ? String(qr.qrId) : "";
//       const qrDoc = qid ? qrMap[qid] : null;

//       const enrichedQr = qr
//         ? {
//             ...qr,
//             label: qr.label ?? (qrDoc ? qrDoc.label : null),
//             type: qr.type ?? (qrDoc ? qrDoc.type : null),
//             number: qr.number ?? (qrDoc ? qrDoc.number : null),
//           }
//         : null;

//       // ✅ filter items per station (if station filter enabled)
//       const stationItems = filterItemsForStation(o.items || []);

//       // If station filter is enabled and this order has no items for that station, skip it.
//       if (isStationFiltered && stationItems.length === 0) continue;

//       const mapped = {
//         id: String(o._id),
//         orderNumber: o.orderNumber,
//         tokenNumber: o.tokenNumber ?? null,
//         status: o.status || "Pending",
//         branchId: o.branchId,
//         currency: o.currency,
//         pricing: o.pricing || null,
//         qr: enrichedQr,
//         customer: o.customer || null,

//         // ✅ IMPORTANT: items returned to KDS are station-specific when station is provided
//         items: stationItems,

//         // ✅ Optional but useful for cashier / “ALL” screen
//         stationSummary: isStationFiltered
//           ? null
//           : computeStationSummary(o.items || []),

//         placedAt: o.placedAt ?? null,
//         createdAt: o.createdAt ?? null,
//         updatedAt: o.updatedAt ?? null,
//         readyAt: o.readyAt ?? null,
//         servedAt: o.servedAt ?? null,
//       };

//       if (bucket === "active") active.push(mapped);
//       else if (bucket === "completed") completed.push(mapped);
//       else cancelled.push(mapped);
//     }

//     return res.status(200).json({
//       shift: {
//         tz,
//         from: startTz.toISO(),
//         to: endTz.toISO(),
//         label,
//       },

//       // ✅ include station info in response so frontend knows what it’s viewing
//       station: {
//         key: isStationFiltered ? stationKey : "ALL",
//         filtered: isStationFiltered,
//       },

//       counts: {
//         active: active.length,
//         completed: completed.length,
//         cancelled: cancelled.length,
//         total: active.length + completed.length + cancelled.length,
//       },

//       help: {
//         openCount: helpOpen.length,
//         open: helpOpen,
//       },

//       active,
//       completed,
//       cancelled,
//     });
//   } catch (err) {
//     console.error("getKdsOverview error:", err);
//     return res.status(500).json({ error: err.message || "Server error" });
//   }
// };

// /**
//  * PATCH /api/kds/orders/:id/status
//  * Body: { status: "READY" | "Ready" | "Preparing" ... , branchId? }
//  */
// export const updateKdsOrderStatus = async (req, res) => {
//   try {
//     const id = String(req.params.id || "").trim();
//     const incoming = String(req.body?.status || "").trim();

//     if (!mongoose.Types.ObjectId.isValid(id)) {
//       return res.status(400).json({ error: "Invalid order id" });
//     }
//     if (!incoming) return res.status(400).json({ error: "Missing status" });

//     const branchId = String(
//       req.body?.branchId || req.query.branchId || "",
//     ).trim();

//     const nextStatusLabel = toLabel(incoming);
//     if (!nextStatusLabel) {
//       return res.status(400).json({ error: "Invalid status value" });
//     }

//     const order = await Order.findById(id);
//     if (!order) return res.status(404).json({ error: "Order not found" });

//     if (branchId && String(order.branchId || "") !== branchId) {
//       return res.status(403).json({ error: "Branch mismatch" });
//     }

//     const currentLabel = String(order.status || "Pending").trim();

//     // ✅ transition rules
//     if (!canTransition(currentLabel, nextStatusLabel)) {
//       return res.status(409).json({
//         error: "Invalid status transition",
//         from: currentLabel,
//         to: nextStatusLabel,
//       });
//     }

//     // ✅ If moving to READY, stamp readyAt
//     const nextCode = toCode(nextStatusLabel);
//     const now = new Date();

//     order.status = nextStatusLabel;

//     if (nextCode === "READY") {
//       // Only set if not already set
//       if (!order.readyAt) order.readyAt = now;
//     }

//     if (nextCode === "SERVED") {
//       if (!order.servedAt) order.servedAt = now;
//     }

//     await order.save();

//     return res.status(200).json({
//       message: "Status updated",
//       order: {
//         id: String(order._id),
//         status: order.status,
//         readyAt: order.readyAt ?? null,
//         servedAt: order.servedAt ?? null,
//         updatedAt: order.updatedAt ?? null,
//       },
//     });
//   } catch (err) {
//     console.error("updateKdsOrderStatus error:", err);
//     return res.status(500).json({ error: err.message || "Server error" });
//   }
// };

// /**
//  * PATCH /api/kds/orders/:id/items/:lineId/availability
//  * Body: { availability: "OUT_OF_STOCK" | "AVAILABLE", reason?: string, branchId?: string }
//  */
// export const updateKdsOrderItemAvailability = async (req, res) => {
//   try {
//     const id = String(req.params.id || "").trim();
//     const lineId = String(req.params.lineId || "").trim();

//     const availability = String(req.body?.availability || "")
//       .trim()
//       .toUpperCase();
//     const reason = String(req.body?.reason || "").trim();
//     const branchId = String(
//       req.body?.branchId || req.query.branchId || "",
//     ).trim();

//     if (!mongoose.Types.ObjectId.isValid(id)) {
//       return res.status(400).json({ error: "Invalid order id" });
//     }
//     if (!mongoose.Types.ObjectId.isValid(lineId)) {
//       return res.status(400).json({ error: "Invalid line id" });
//     }
//     if (!["AVAILABLE", "OUT_OF_STOCK"].includes(availability)) {
//       return res.status(400).json({ error: "Invalid availability value" });
//     }

//     const order = await Order.findById(id);
//     if (!order) return res.status(404).json({ error: "Order not found" });

//     if (branchId && String(order.branchId || "") !== branchId) {
//       return res.status(403).json({ error: "Branch mismatch" });
//     }

//     // block terminal orders
//     const cur = String(order.status || "").toLowerCase();
//     if (["completed", "cancelled", "canceled", "rejected"].includes(cur)) {
//       return res
//         .status(409)
//         .json({ error: "Order is terminal; cannot amend items" });
//     }

//     const it = order.items?.id(lineId);
//     if (!it) return res.status(404).json({ error: "Line item not found" });

//     const now = new Date();
//     const userId = req.user?.uid || req.user?.email || req.user?.sub || null;

//     if (availability === "OUT_OF_STOCK") {
//       it.availability = "OUT_OF_STOCK";
//       it.unavailableReason = reason || it.unavailableReason || "Out of stock";
//       it.unavailableAt = now;
//       it.unavailableBy = userId;
//     } else {
//       it.availability = "AVAILABLE";
//       it.unavailableReason = null;
//       it.unavailableAt = null;
//       it.unavailableBy = null;
//     }

//     // ✅ bump revision so customer + KDS can detect amendments
//     order.revision = (order.revision || 0) + 1;

//     // ✅ optional lastChange for customer UI
//     order.lastChange = {
//       type: "ITEM_OUT_OF_STOCK",
//       at: now,
//       by: userId,
//       payload: {
//         lineId,
//         availability,
//         reason:
//           availability === "OUT_OF_STOCK"
//             ? it.unavailableReason || reason || null
//             : null,
//       },
//     };

//     // ✅ recompute totals automatically
//     recomputeOrderPricing(order);

//     await order.save();

//     return res.status(200).json({
//       ok: true,
//       message: "Item availability updated",
//       order: {
//         id: String(order._id),
//         revision: order.revision,
//         status: order.status,
//         pricing: order.pricing,
//         lastChange: order.lastChange || null,
//         items: order.items,
//         updatedAt: order.updatedAt ?? null,
//       },
//     });
//   } catch (err) {
//     console.error("updateKdsOrderItemAvailability error:", err);
//     return res.status(500).json({ error: err.message || "Server error" });
//   }
// };

// /**
//  * PATCH /api/kds/help/:id/ack
//  * Body: { branchId: "BR-000004" }
//  * Protected by verifyFirebaseToken (route-level)
//  */
// export const ackHelpRequest = async (req, res) => {
//   try {
//     const id = String(req.params.id || "").trim();
//     const branchId = String(
//       req.body?.branchId || req.query.branchId || "",
//     ).trim();

//     if (!mongoose.Types.ObjectId.isValid(id)) {
//       return res.status(400).json({ error: "Invalid help id" });
//     }
//     if (!branchId) return res.status(400).json({ error: "Missing branchId" });

//     const help = await HelpRequest.findById(id);
//     if (!help) return res.status(404).json({ error: "Help request not found" });

//     if (String(help.branchId || "") !== branchId) {
//       return res.status(403).json({ error: "Branch mismatch" });
//     }

//     // idempotent
//     if (String(help.status || "") !== "OPEN") {
//       return res.status(200).json({
//         ok: true,
//         message: "Help request already closed",
//         help: { id: String(help._id), status: help.status },
//       });
//     }

//     help.status = "ACK";
//     help.ackAt = new Date();

//     // If your verifyFirebaseToken adds req.user, store it. Safe fallback to null.
//     help.ackBy = req.user?.uid || req.user?.email || req.user?.sub || null;

//     await help.save();

//     return res.status(200).json({
//       ok: true,
//       message: "Help request acknowledged",
//       help: {
//         id: String(help._id),
//         status: help.status,
//         ackAt: help.ackAt,
//         ackBy: help.ackBy ?? null,
//       },
//     });
//   } catch (err) {
//     console.error("ackHelpRequest error:", err);
//     return res.status(500).json({ error: err.message || "Server error" });
//   }
// };

// // ✅ OPTIONAL: if you want hashed pins, enable bcrypt
// // import bcrypt from "bcryptjs";

// // GET /api/kds/stations?branchId=BR-000005
// function normStationKey(v) {
//   const s = String(v ?? "").trim();
//   return s ? s.toUpperCase() : "";
// }

// export const getKdsStations = async (req, res) => {
//   try {
//     const branchId = String(req.query.branchId || "").trim();
//     if (!branchId) return res.status(400).json({ error: "Missing branchId" });

//     const branch = await Branch.findOne({ branchId }).lean();
//     if (!branch) return res.status(404).json({ error: "Branch not found" });

//     // ✅ YOUR REAL FIELD
//     const stationsRaw = Array.isArray(branch.stations)
//       ? branch.stations
//       : Array.isArray(branch.kdsStations)
//         ? branch.kdsStations
//         : [];

//     const stations = stationsRaw
//       .filter((s) => s && s.isEnabled !== false)
//       .map((s) => ({
//         stationId: s.stationId ?? null,
//         key: normStationKey(s.key),
//         nameEnglish: String(
//           s.nameEnglish || s.name || s.label || s.key || "",
//         ).trim(),
//         nameArabic: String(s.nameArabic || "").trim(),
//         sortOrder: Number.isFinite(Number(s.sortOrder))
//           ? Number(s.sortOrder)
//           : 0,
//         hasPin: !!String(s.pinHash || "").trim(), // ✅ shows if PIN exists
//       }))
//       .filter((s) => s.key)
//       .sort((a, b) => a.sortOrder - b.sortOrder);

//     return res.status(200).json({
//       ok: true,
//       branchId,
//       stations,
//     });
//   } catch (err) {
//     console.error("getKdsStations error:", err);
//     return res.status(500).json({ error: err.message || "Server error" });
//   }
// };

// // POST /api/kds/stations/login
// // Body: { branchId, stationKey, pin }
// export const loginKdsStation = async (req, res) => {
//   try {
//     const branchId = String(req.body?.branchId || "").trim();
//     const stationKey = normStationKey(req.body?.stationKey);
//     const pin = String(req.body?.pin || "").trim(); // may be empty for MAIN

//     if (!branchId) return res.status(400).json({ error: "Missing branchId" });
//     if (!stationKey)
//       return res.status(400).json({ error: "Missing stationKey" });

//     const branch = await Branch.findOne({ branchId });
//     if (!branch) return res.status(404).json({ error: "Branch not found" });

//     const stationsRaw = Array.isArray(branch.stations)
//       ? branch.stations
//       : Array.isArray(branch.kdsStations)
//         ? branch.kdsStations
//         : [];

//     const idx = stationsRaw.findIndex(
//       (s) => normStationKey(s?.key) === stationKey && s?.isEnabled !== false,
//     );

//     if (idx < 0) {
//       return res.status(400).json({ error: "Invalid station", stationKey });
//     }

//     const st = stationsRaw[idx];

//     // ✅ MAIN: no PIN required (ignore whatever user sends)
//     if (stationKey === "MAIN") {
//       return res.status(200).json({
//         ok: true,
//         branchId,
//         station: {
//           stationId: st.stationId ?? null,
//           key: stationKey,
//           nameEnglish: st.nameEnglish || "Main",
//           nameArabic: st.nameArabic || "",
//         },
//       });
//     }

//     // ✅ For others: require pinHash + bcrypt compare
//     const hash = String(st.pinHash || "").trim();
//     if (!hash) {
//       return res.status(409).json({ error: "Station PIN not configured" });
//     }
//     if (!pin) {
//       return res.status(400).json({ error: "Missing pin" });
//     }

//     // Optional lock check (your schema has pinLockUntil)
//     const lockUntil = st.pinLockUntil ? new Date(st.pinLockUntil) : null;
//     if (lockUntil && lockUntil > new Date()) {
//       return res.status(423).json({
//         error: "Station locked",
//         lockUntil,
//       });
//     }

//     const ok = await bcrypt.compare(pin, hash);

//     if (!ok) {
//       // increment failed count (basic)
//       st.pinFailedCount = (st.pinFailedCount || 0) + 1;

//       // optional: lock after 5 failures for 5 minutes
//       if (st.pinFailedCount >= 5) {
//         st.pinLockUntil = new Date(Date.now() + 5 * 60 * 1000);
//         st.pinFailedCount = 0;
//       }

//       await branch.save();

//       return res.status(401).json({ error: "Invalid PIN" });
//     }

//     // ✅ reset counters on success
//     st.pinFailedCount = 0;
//     st.pinLockUntil = null;
//     await branch.save();

//     return res.status(200).json({
//       ok: true,
//       branchId,
//       station: {
//         stationId: st.stationId ?? null,
//         key: stationKey,
//         nameEnglish: st.nameEnglish || st.name || st.label || stationKey,
//         nameArabic: st.nameArabic || "",
//       },
//     });
//   } catch (err) {
//     console.error("loginKdsStation error:", err);
//     return res.status(500).json({ error: err.message || "Server error" });
//   }
// };
