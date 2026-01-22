// // src/controllers/kdsController.js
// src/controllers/kdsController.js
import { DateTime } from "luxon";
import mongoose from "mongoose";
import Branch from "../models/Branch.js";
import Order from "../models/Order.js";
import Qr from "../models/QrCodeOrders.js";

const DAY_KEYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function parseRange(rangeStr) {
  const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(String(rangeStr || "").trim());
  if (!m) return null;
  return {
    startH: Number(m[1]),
    startM: Number(m[2]),
    endH: Number(m[3]),
    endM: Number(m[4]),
  };
}

function buildShiftWindowForDay(baseDate, range) {
  const start = baseDate.set({ hour: range.startH, minute: range.startM, second: 0, millisecond: 0 });
  let end = baseDate.set({ hour: range.endH, minute: range.endM, second: 0, millisecond: 0 });
  if (end <= start) end = end.plus({ days: 1 });
  return { start, end };
}

function getDayKey(dt) {
  return DAY_KEYS[dt.weekday - 1];
}

function resolveCurrentShiftWindow({ openingHours, tz, now }) {
  const nowTz = (now ? now.setZone(tz) : DateTime.now().setZone(tz));

  const todayKey = getDayKey(nowTz);
  const todayRange = parseRange(openingHours?.[todayKey]);

  const todayBase = nowTz.startOf("day");
  const todayWindow = todayRange ? buildShiftWindowForDay(todayBase, todayRange, tz) : null;

  const yTz = nowTz.minus({ days: 1 });
  const yKey = getDayKey(yTz);
  const yRange = parseRange(openingHours?.[yKey]);
  const yBase = yTz.startOf("day");
  const yWindow = yRange ? buildShiftWindowForDay(yBase, yRange, tz) : null;

  if (yWindow && nowTz >= yWindow.start && nowTz < yWindow.end) {
    return {
      startTz: yWindow.start,
      endTz: yWindow.end,
      label: `${yKey} ${yWindow.start.toFormat("HH:mm")} → ${getDayKey(yWindow.end)} ${yWindow.end.toFormat("HH:mm")}`,
    };
  }

  if (todayWindow) {
    return {
      startTz: todayWindow.start,
      endTz: todayWindow.end,
      label: `${todayKey} ${todayWindow.start.toFormat("HH:mm")} → ${getDayKey(todayWindow.end)} ${todayWindow.end.toFormat("HH:mm")}`,
    };
  }

  const start = nowTz.startOf("day");
  const end = start.plus({ days: 1 });
  return {
    startTz: start,
    endTz: end,
    label: `${todayKey} ${start.toFormat("HH:mm")} → ${getDayKey(end)} ${end.toFormat("HH:mm")}`,
  };
}

function normalizeStatus(s) {
  return String(s || "").trim().toLowerCase();
}

function classifyStatus(raw) {
  const s = normalizeStatus(raw);

  if (["pending", "accepted", "preparing", "ready"].includes(s)) return "active";
  if (["served", "completed", "paid", "closed", "delivered"].includes(s)) return "completed";
  if (["cancelled", "canceled", "void", "rejected"].includes(s)) return "cancelled";

  return "active";
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

  const found = Object.values(STATUS_CODE_TO_LABEL).find((lbl) => toCode(lbl) === code);
  return found || null;
};

const isTerminal = (label) => {
  const s = normalizeStatus(label);
  return ["completed", "cancelled", "canceled", "rejected"].includes(s);
};

function canTransition(currentLabel, nextLabel) {
  const cur = toCode(currentLabel);
  const nxt = toCode(nextLabel);

  if (cur === nxt) return true;
  if (isTerminal(currentLabel)) return false;

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

// ✅ cycle accessor (supports both cycle and cycleNo)
function cycleNoOf(c) {
  const v = c?.cycle ?? c?.cycleNo;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Compute overall order status from kitchenCycles/items lineStatus.
 * Works even if cycles/items are missing.
 */
function computeOverallStatusFromCycles(kitchenCycles) {
  const cycles = Array.isArray(kitchenCycles) ? kitchenCycles : [];

  const lineStatuses = [];
  for (const c of cycles) {
    const items = Array.isArray(c?.items) ? c.items : [];
    for (const it of items) {
      const s = toCode(it?.lineStatus || "");
      if (s) lineStatuses.push(s);
    }
  }

  if (lineStatuses.length === 0) return "";

  if (lineStatuses.includes("PREPARING")) return "PREPARING";
  if (lineStatuses.includes("PENDING")) return "PENDING";
  if (lineStatuses.includes("READY")) return "READY";
  if (lineStatuses.every((s) => s === "SERVED")) return "SERVED";
  if (lineStatuses.includes("SERVED")) return "SERVED";

  return "";
}

/**
 * GET /api/kds/overview?branchId=BR-000004
 */
export const getKdsOverview = async (req, res) => {
  try {
    const branchId = String(req.query.branchId || "").trim();
    if (!branchId) return res.status(400).json({ error: "Missing branchId" });

    const branch = await Branch.findOne({ branchId }).lean();
    if (!branch) return res.status(404).json({ error: "Branch not found" });

    const tz = String(branch.timeZone || req.query.tz || "Asia/Bahrain").trim();
    const openingHours = branch.openingHours || {};

    const { startTz, endTz, label } = resolveCurrentShiftWindow({ openingHours, tz });

    const fromUtc = startTz.toUTC().toJSDate();
    const toUtc = endTz.toUTC().toJSDate();

    const timeQuery = {
      $or: [
        { placedAt: { $gte: fromUtc, $lt: toUtc } },
        { createdAt: { $gte: fromUtc, $lt: toUtc } },
      ],
    };

    // ✅ AUTO SERVE: READY -> SERVED after 60s (BACKWARD COMPATIBLE)
    const now = new Date();
    const cutoff = new Date(now.getTime() - 60 * 1000);

    await Order.updateMany(
      {
        branchId,
        ...timeQuery,
        status: "Ready",
        readyAt: { $exists: true, $ne: null, $lte: cutoff },
        $or: [
          { readyAtCycle: { $exists: false } }, // old orders
          { readyAtCycle: null },               // old orders
          { $expr: { $eq: ["$readyAtCycle", "$kitchenCycle"] } }, // new orders
        ],
      },
      {
        $set: { status: "Served", servedAt: now },
        $inc: { revision: 1 },
      }
    );

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
        orders
          .map((o) => o?.qr?.qrId)
          .filter(Boolean)
          .map(String)
      ),
    ];

    let qrMap = {};
    if (qrIds.length) {
      const qrs = await Qr.find(
        { qrId: { $in: qrIds } },
        { qrId: 1, label: 1, type: 1, number: 1 }
      ).lean();

      qrMap = qrs.reduce((acc, q) => {
        acc[String(q.qrId)] = q;
        return acc;
      }, {});
    }

    const active = [];
    const completed = [];
    const cancelled = [];

    for (const o of orders) {
      const bucket = classifyStatus(o.status);

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

      // ✅ IMPORTANT: pick items from active cycle (THIS is what you want!)
      const cycles = Array.isArray(o.kitchenCycles) ? o.kitchenCycles : [];
      const activeCycleNo = Number(o.kitchenCycle || 1) || 1;

      // support either `cycle` or older `cycleNo`
      const activeCycle =
        cycles.find((c) => Number(c?.cycle) === activeCycleNo) ||
        cycles.find((c) => Number(c?.cycleNo) === activeCycleNo) ||
        cycles[cycles.length - 1] ||
        null;

      const cycleItemsRaw = Array.isArray(activeCycle?.items) ? activeCycle.items : [];

      // normalize lineStatus if missing
      const cycleItems = cycleItemsRaw.map((it) => ({
        ...it,
        lineStatus: it?.lineStatus || it?.kitchenStatus || "PENDING",
        kitchenCycle: it?.kitchenCycle ?? activeCycleNo,
        lineId: it?.lineId ?? it?._id ?? null,
      }));

      const mapped = {
        id: String(o._id),
        orderNumber: o.orderNumber,
        tokenNumber: o.tokenNumber ?? null,
        status: o.status || "Pending",
        branchId: o.branchId,
        currency: o.currency,
        pricing: o.pricing || null,
        qr: enrichedQr,
        customer: o.customer || null,

        // ✅ THIS is now cycle items (with lineStatus)
        items: cycleItems,

        // keep legacy too so nothing breaks anywhere else
        legacyItems: o.items || [],

        placedAt: o.placedAt ?? null,
        createdAt: o.createdAt ?? null,
        updatedAt: o.updatedAt ?? null,
        readyAt: o.readyAt ?? null,
        servedAt: o.servedAt ?? null,

        revision: o.revision ?? 0,
        kitchenCycle: activeCycleNo,
        activeCycle: activeCycle
          ? {
              cycle: activeCycle.cycle ?? activeCycle.cycleNo ?? activeCycleNo,
              status: activeCycle.status ?? null,
              startedAt: activeCycle.startedAt ?? null,
              completedAt: activeCycle.completedAt ?? null,
            }
          : null,
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
      counts: {
        active: active.length,
        completed: completed.length,
        cancelled: cancelled.length,
        total: orders.length,
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

// export const getKdsOverview = async (req, res) => {
//   try {
//     const branchId = String(req.query.branchId || "").trim();
//     if (!branchId) return res.status(400).json({ error: "Missing branchId" });

//     const branch = await Branch.findOne({ branchId }).lean();
//     if (!branch) return res.status(404).json({ error: "Branch not found" });

//     const tz = String(branch.timeZone || req.query.tz || "Asia/Bahrain").trim();
//     const openingHours = branch.openingHours || {};

//     const { startTz, endTz, label } = resolveCurrentShiftWindow({ openingHours, tz });

//     const fromUtc = startTz.toUTC().toJSDate();
//     const toUtc = endTz.toUTC().toJSDate();

//     const timeQuery = {
//       $or: [
//         { placedAt: { $gte: fromUtc, $lt: toUtc } },
//         { createdAt: { $gte: fromUtc, $lt: toUtc } },
//       ],
//     };

//     // ✅ AUTO SERVE: READY -> SERVED after 60s
//     // IMPORTANT: This runs only when this endpoint is called (KDS polling).
//     const now = new Date();
//     const cutoff = new Date(now.getTime() - 60 * 1000);

//     // ✅ Backward compatible + type-safe cycle match:
//     // - If readyAtCycle missing/null -> still auto serve (old behavior)
//     // - Else serve only if readyAtCycle == kitchenCycle (string/number tolerant)
//     const autoServeFilter = {
//       branchId,
//       ...timeQuery,
//       status: "Ready",
//       readyAt: { $exists: true, $ne: null, $lte: cutoff },
//       $or: [
//         { readyAtCycle: { $exists: false } },
//         { readyAtCycle: null },
//         {
//           $expr: {
//             $eq: [
//               { $toString: "$readyAtCycle" },
//               { $toString: "$kitchenCycle" },
//             ],
//           },
//         },
//       ],
//     };

//     const autoServeUpdate = {
//       $set: { status: "Served", servedAt: now },
//       $inc: { revision: 1 },
//     };

//     const autoResult = await Order.updateMany(autoServeFilter, autoServeUpdate);

//     // Optional debug (keep or remove)
//     // console.log("[KDS] auto-serve matched:", autoResult?.matchedCount, "modified:", autoResult?.modifiedCount);

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
//         orders
//           .map((o) => o?.qr?.qrId)
//           .filter(Boolean)
//           .map(String)
//       ),
//     ];

//     let qrMap = {};
//     if (qrIds.length) {
//       const qrs = await Qr.find(
//         { qrId: { $in: qrIds } },
//         { qrId: 1, label: 1, type: 1, number: 1 }
//       ).lean();

//       qrMap = qrs.reduce((acc, q) => {
//         acc[String(q.qrId)] = q;
//         return acc;
//       }, {});
//     }

//     const active = [];
//     const completed = [];
//     const cancelled = [];

//     for (const o of orders) {
//       const bucket = classifyStatus(o.status);

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
//         items: o.items || [],
//         placedAt: o.placedAt ?? null,
//         createdAt: o.createdAt ?? null,
//         updatedAt: o.updatedAt ?? null,
//         readyAt: o.readyAt ?? null,
//         servedAt: o.servedAt ?? null,
//         revision: o.revision ?? 0,
//         kitchenCycle: o.kitchenCycle ?? 1,
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
//       counts: {
//         active: active.length,
//         completed: completed.length,
//         cancelled: cancelled.length,
//         total: orders.length,
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


/**
 * PATCH /api/kds/orders/:id/status
 * Body: { status: "PREPARING" | "READY" | "SERVED" | "COMPLETED" | "REJECTED" | label, branchId }
 */
export const updateKdsOrderStatus = async (req, res) => {
  try {
    const orderId = String(req.params.id || "").trim();
    const { status, branchId } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ error: "Invalid order id" });
    }
    if (!branchId) return res.status(400).json({ error: "Missing branchId" });

    const nextLabel = toLabel(status);
    if (!nextLabel) return res.status(400).json({ error: "Invalid status value" });

    const order = await Order.findOne({
      _id: orderId,
      branchId: String(branchId).trim(),
    });

    if (!order) return res.status(404).json({ error: "Order not found" });

    if (!canTransition(order.status, nextLabel)) {
      return res.status(400).json({
        error: "Invalid status transition",
        from: order.status,
        to: nextLabel,
      });
    }

    if (!Array.isArray(order.kitchenCycles)) order.kitchenCycles = [];
    if (order.kitchenCycles.length === 0) {
      const cno = Number(order.kitchenCycle || 1) || 1;
      order.kitchenCycles.push({ cycle: cno, cycleNo: cno, items: [] });
    }

    const activeCycleNo = Number(order.kitchenCycle || 1) || 1;

    // find cycle by (cycle OR cycleNo)
    let activeCycle = order.kitchenCycles.find((c) => {
      const n = Number(c?.cycle ?? c?.cycleNo);
      return n === activeCycleNo;
    });

    if (!activeCycle) {
      activeCycle = { cycle: activeCycleNo, cycleNo: activeCycleNo, items: [] };
      order.kitchenCycles.push(activeCycle);
    }

    if (!Array.isArray(activeCycle.items)) activeCycle.items = [];

    const nextCode = toCode(nextLabel);
    const now = new Date();

    if (nextCode === "PREPARING") {
      for (const it of activeCycle.items) {
        const cur = toCode(it?.lineStatus || "PENDING");
        if (cur === "" || cur === "PENDING") it.lineStatus = "PREPARING";
      }
      order.kitchenCycle = activeCycleNo;
    } else if (nextCode === "READY") {
      for (const it of activeCycle.items) {
        const cur = toCode(it?.lineStatus || "PENDING");
        if (cur === "PENDING" || cur === "PREPARING") it.lineStatus = "READY";
      }
      order.status = "Ready";
      order.readyAt = now;

      // ✅ critical for auto-serve
      order.kitchenCycle = activeCycleNo;
      order.readyAtCycle = activeCycleNo;
    } else if (nextCode === "SERVED") {
      for (const it of activeCycle.items) {
        const cur = toCode(it?.lineStatus || "PENDING");
        if (cur === "PENDING" || cur === "PREPARING" || cur === "READY") {
          it.lineStatus = "SERVED";
        }
      }
      order.status = "Served";
      order.servedAt = now;
      order.kitchenCycle = activeCycleNo;
    } else if (nextCode === "COMPLETED") {
      order.status = "Completed";
    } else if (nextCode === "REJECTED") {
      order.status = "Rejected";
    } else if (nextCode === "CANCELLED" || nextCode === "CANCELED") {
      order.status = "Cancelled";
    } else if (nextCode === "PENDING") {
      order.status = "Pending";
    } else {
      return res.status(400).json({ error: "Invalid status value" });
    }

    // keep overall consistent if cycles provide signal
    const computed = computeOverallStatusFromCycles(order.kitchenCycles);
    if (computed && !isTerminal(order.status)) {
      order.status = STATUS_CODE_TO_LABEL[computed] || order.status;
    }

    order.revision = Number(order.revision || 0) + 1;

    await order.save();

    return res.status(200).json({
      message: "Status updated",
      order: {
        id: String(order._id),
        status: order.status,
        revision: order.revision ?? 0,
        kitchenCycle: order.kitchenCycle ?? 1,
        readyAt: order.readyAt ?? null,
        readyAtCycle: order.readyAtCycle ?? null,
        servedAt: order.servedAt ?? null,
      },
    });
  } catch (err) {
    console.error("updateKdsOrderStatus error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};

// export const updateKdsOrderStatus = async (req, res) => {
//   try {
//     const orderId = String(req.params.id || "").trim();
//     const { status, branchId } = req.body || {};

//     if (!mongoose.Types.ObjectId.isValid(orderId)) {
//       return res.status(400).json({ error: "Invalid order id" });
//     }
//     if (!branchId) return res.status(400).json({ error: "Missing branchId" });

//     const nextLabel = toLabel(status);
//     if (!nextLabel) return res.status(400).json({ error: "Invalid status value" });

//     const order = await Order.findOne({
//       _id: orderId,
//       branchId: String(branchId).trim(),
//     });

//     if (!order) return res.status(404).json({ error: "Order not found" });

//     if (!canTransition(order.status, nextLabel)) {
//       return res.status(400).json({
//         error: "Invalid status transition",
//         from: order.status,
//         to: nextLabel,
//       });
//     }

//     // Ensure kitchenCycles exists
//     if (!Array.isArray(order.kitchenCycles)) order.kitchenCycles = [];

//     // Ensure at least one cycle exists
//     if (order.kitchenCycles.length === 0) {
//       const cno = Number(order.kitchenCycle || 1) || 1;
//       order.kitchenCycles.push({
//         cycle: cno,
//         cycleNo: cno, // keep both to be safe
//         items: [],
//       });
//     }

//     const activeCycleNo = Number(order.kitchenCycle || 1) || 1;

//     // Find the active cycle (support cycle OR cycleNo)
//     let activeCycle = order.kitchenCycles.find((c) => cycleNoOf(c) === activeCycleNo);

//     // If not found, fallback to max cycle in doc (or create)
//     if (!activeCycle) {
//       const maxCycle =
//         order.kitchenCycles
//           .map((c) => cycleNoOf(c))
//           .filter((n) => n !== null)
//           .sort((a, b) => b - a)[0] || activeCycleNo;

//       activeCycle = order.kitchenCycles.find((c) => cycleNoOf(c) === maxCycle);

//       if (!activeCycle) {
//         activeCycle = { cycle: activeCycleNo, cycleNo: activeCycleNo, items: [] };
//         order.kitchenCycles.push(activeCycle);
//       }
//     }

//     if (!Array.isArray(activeCycle.items)) activeCycle.items = [];

//     const nextCode = toCode(nextLabel);
//     const now = new Date();

//     if (nextCode === "PREPARING") {
//       for (const it of activeCycle.items) {
//         const cur = toCode(it?.lineStatus || "PENDING");
//         if (cur === "" || cur === "PENDING") it.lineStatus = "PREPARING";
//       }
//     } else if (nextCode === "READY") {
//       for (const it of activeCycle.items) {
//         const cur = toCode(it?.lineStatus || "PENDING");
//         if (cur === "PENDING" || cur === "PREPARING") it.lineStatus = "READY";
//       }
//       order.readyAt = now;
//       order.readyAtCycle = activeCycleNo;
//     } else if (nextCode === "SERVED") {
//       for (const it of activeCycle.items) {
//         const cur = toCode(it?.lineStatus || "PENDING");
//         if (cur === "PENDING" || cur === "PREPARING" || cur === "READY") {
//           it.lineStatus = "SERVED";
//         }
//       }
//       order.servedAt = now;
//     } else if (nextCode === "COMPLETED") {
//       // no line change required
//     } else if (nextCode === "REJECTED" || nextCode === "CANCELLED") {
//       // no line change required
//     }

//     // Set label status
//     order.status = nextLabel;

//     // Keep overall consistent with cycles if cycles provide meaningful computed state
//     const computed = computeOverallStatusFromCycles(order.kitchenCycles);
//     if (computed && !isTerminal(order.status)) {
//       order.status = STATUS_CODE_TO_LABEL[computed] || order.status;
//     }

//     // bump revision
//     order.revision = Number(order.revision || 0) + 1;

//     await order.save();

//     return res.status(200).json({
//       message: "Status updated",
//       order: {
//         id: String(order._id),
//         status: order.status,
//         revision: order.revision ?? 0,
//         kitchenCycle: order.kitchenCycle ?? 1,
//         readyAt: order.readyAt ?? null,
//         servedAt: order.servedAt ?? null,
//       },
//     });
//   } catch (err) {
//     console.error("updateKdsOrderStatus error:", err);
//     return res.status(500).json({ error: err.message || "Server error" });
//   }
// };


// import { DateTime } from "luxon";
// import mongoose from "mongoose";
// import Branch from "../models/Branch.js";
// import Order from "../models/Order.js";
// import Qr from "../models/QrCodeOrders.js"; // ✅ or whatever your QR model file is called


// const DAY_KEYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// function parseRange(rangeStr) {
//   const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(String(rangeStr || "").trim());
//   if (!m) return null;
//   return {
//     startH: Number(m[1]),
//     startM: Number(m[2]),
//     endH: Number(m[3]),
//     endM: Number(m[4]),
//   };
// }

// function buildShiftWindowForDay(baseDate, range, tz) {
//   const start = baseDate.set({ hour: range.startH, minute: range.startM, second: 0, millisecond: 0 });
//   let end = baseDate.set({ hour: range.endH, minute: range.endM, second: 0, millisecond: 0 });
//   if (end <= start) end = end.plus({ days: 1 });
//   return { start, end };
// }

// function getDayKey(dt) {
//   return DAY_KEYS[dt.weekday - 1];
// }

// function resolveCurrentShiftWindow({ openingHours, tz, now }) {
//   const nowTz = (now ? now.setZone(tz) : DateTime.now().setZone(tz));

//   const todayKey = getDayKey(nowTz);
//   const todayRange = parseRange(openingHours?.[todayKey]);

//   const todayBase = nowTz.startOf("day");
//   const todayWindow = todayRange ? buildShiftWindowForDay(todayBase, todayRange, tz) : null;

//   const yTz = nowTz.minus({ days: 1 });
//   const yKey = getDayKey(yTz);
//   const yRange = parseRange(openingHours?.[yKey]);
//   const yBase = yTz.startOf("day");
//   const yWindow = yRange ? buildShiftWindowForDay(yBase, yRange, tz) : null;

//   if (yWindow && nowTz >= yWindow.start && nowTz < yWindow.end) {
//     return {
//       startTz: yWindow.start,
//       endTz: yWindow.end,
//       label: `${yKey} ${yWindow.start.toFormat("HH:mm")} → ${getDayKey(yWindow.end)} ${yWindow.end.toFormat("HH:mm")}`,
//     };
//   }

//   if (todayWindow) {
//     return {
//       startTz: todayWindow.start,
//       endTz: todayWindow.end,
//       label: `${todayKey} ${todayWindow.start.toFormat("HH:mm")} → ${getDayKey(todayWindow.end)} ${todayWindow.end.toFormat("HH:mm")}`,
//     };
//   }

//   const start = nowTz.startOf("day");
//   const end = start.plus({ days: 1 });
//   return {
//     startTz: start,
//     endTz: end,
//     label: `${todayKey} ${start.toFormat("HH:mm")} → ${getDayKey(end)} ${end.toFormat("HH:mm")}`,
//   };
// }

// function normalizeStatus(s) {
//   return String(s || "").trim().toLowerCase();
// }

// function classifyStatus(raw) {
//   const s = normalizeStatus(raw);

//   // ✅ Active tab should include your kitchen flow
//   if (["pending", "accepted", "preparing", "ready"].includes(s)) return "active";

//   // ✅ Completed tab
//   if (["served", "completed", "paid", "closed", "delivered"].includes(s)) return "completed";

//   // ✅ Cancelled tab
//   if (["cancelled", "canceled", "void", "rejected"].includes(s)) return "cancelled";

//   return "active";
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
//   const found = Object.values(STATUS_CODE_TO_LABEL).find((lbl) => toCode(lbl) === code);
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
//  * GET /api/kds/overview?branchId=BR-000004
//  */


// export const getKdsOverview = async (req, res) => {
//   try {
//     const branchId = String(req.query.branchId || "").trim();
//     if (!branchId) return res.status(400).json({ error: "Missing branchId" });

//     const branch = await Branch.findOne({ branchId }).lean();
//     if (!branch) return res.status(404).json({ error: "Branch not found" });

//     const tz = String(branch.timeZone || req.query.tz || "Asia/Bahrain").trim();
//     const openingHours = branch.openingHours || {};

//     const { startTz, endTz, label } = resolveCurrentShiftWindow({ openingHours, tz });

//     const fromUtc = startTz.toUTC().toJSDate();
//     const toUtc = endTz.toUTC().toJSDate();

//     const timeQuery = {
//       $or: [
//         { placedAt: { $gte: fromUtc, $lt: toUtc } },
//         { createdAt: { $gte: fromUtc, $lt: toUtc } },
//       ],
//     };

//     // ✅ AUTO SERVE: READY -> SERVED after 60s (and bump revision)
//     const now = new Date();
//     const cutoff = new Date(now.getTime() - 60 * 1000);

//     await Order.updateMany(
//     {
//       branchId,
//       ...timeQuery,
//       status: "Ready",
//       readyAt: { $exists: true, $ne: null, $lte: cutoff },
//       $expr: { $eq: ["$readyAtCycle", "$kitchenCycle"] }, // ✅ only serve current cycle
//     },
//     {
//     $set: { status: "Served", servedAt: now },
//     $inc: { revision: 1 },
//     }
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
//         orders
//           .map((o) => o?.qr?.qrId)
//           .filter(Boolean)
//           .map(String)
//       ),
//     ];

//     let qrMap = {};
//     if (qrIds.length) {
//       const qrs = await Qr.find(
//         { qrId: { $in: qrIds } },
//         { qrId: 1, label: 1, type: 1, number: 1 }
//       ).lean();

//       qrMap = qrs.reduce((acc, q) => {
//         acc[String(q.qrId)] = q;
//         return acc;
//       }, {});
//     }

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
//         items: o.items || [],
//         placedAt: o.placedAt ?? null,
//         createdAt: o.createdAt ?? null,
//         updatedAt: o.updatedAt ?? null,
//         readyAt: o.readyAt ?? null,
//         servedAt: o.servedAt ?? null,

//         // ✅ NEW (important for add-more / re-open flow)
//         revision: o.revision ?? 0,
//         kitchenCycle: o.kitchenCycle ?? 1,
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
//       counts: {
//         active: active.length,
//         completed: completed.length,
//         cancelled: cancelled.length,
//         total: orders.length,
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



// // export const getKdsOverview = async (req, res) => {
// //   try {
// //     const branchId = String(req.query.branchId || "").trim();
// //     if (!branchId) return res.status(400).json({ error: "Missing branchId" });

// //     const branch = await Branch.findOne({ branchId }).lean();
// //     if (!branch) return res.status(404).json({ error: "Branch not found" });

// //     const tz = String(branch.timeZone || req.query.tz || "Asia/Bahrain").trim();
// //     const openingHours = branch.openingHours || {};

// //     const { startTz, endTz, label } = resolveCurrentShiftWindow({ openingHours, tz });

// //     const fromUtc = startTz.toUTC().toJSDate();
// //     const toUtc = endTz.toUTC().toJSDate();

// //     const timeQuery = {
// //       $or: [
// //         { placedAt: { $gte: fromUtc, $lt: toUtc } },
// //         { createdAt: { $gte: fromUtc, $lt: toUtc } },
// //       ],
// //     };

// //     // ✅ AUTO SERVE: READY -> SERVED after 60s
// //     const now = new Date();
// //     const cutoff = new Date(now.getTime() - 60 * 1000);

// //     await Order.updateMany(
// //       {
// //         branchId,
// //         ...timeQuery,
// //         status: "Ready",
// //         readyAt: { $exists: true, $lte: cutoff },
// //       },
// //       {
// //         $set: { status: "Served", servedAt: now },
// //       }
// //     );

// //     const orders = await Order.find({
// //       branchId,
// //       ...timeQuery,
// //     })
// //       .sort({ createdAt: -1 })
// //       .limit(500)
// //       .lean();

// //     // ✅ Build qrMap from QR collection (qrId -> {label,type,number})
// //     const qrIds = [
// //       ...new Set(
// //         orders
// //           .map((o) => o?.qr?.qrId)
// //           .filter(Boolean)
// //           .map(String)
// //       ),
// //     ];

// //     let qrMap = {};
// //     if (qrIds.length) {
// //       const qrs = await Qr.find(
// //         { qrId: { $in: qrIds } },
// //         { qrId: 1, label: 1, type: 1, number: 1 }
// //       ).lean();

// //       qrMap = qrs.reduce((acc, q) => {
// //         acc[String(q.qrId)] = q;
// //         return acc;
// //       }, {});
// //     }

// //     const active = [];
// //     const completed = [];
// //     const cancelled = [];

// //     for (const o of orders) {
// //       const bucket = classifyStatus(o.status);

// //       // ✅ Enrich QR (add label even if order.qr.label is missing)
// //       const qr = o.qr || null;
// //       const qid = qr?.qrId ? String(qr.qrId) : "";
// //       const qrDoc = qid ? qrMap[qid] : null;

// //       const enrichedQr = qr
// //         ? {
// //             ...qr,
// //             label: qr.label ?? (qrDoc ? qrDoc.label : null),
// //             type: qr.type ?? (qrDoc ? qrDoc.type : null),
// //             number: qr.number ?? (qrDoc ? qrDoc.number : null),
// //           }
// //         : null;

// //       const mapped = {
// //         id: String(o._id),
// //         orderNumber: o.orderNumber,
// //         tokenNumber: o.tokenNumber ?? null,
// //         status: o.status || "Pending",
// //         branchId: o.branchId,
// //         currency: o.currency,
// //         pricing: o.pricing || null,
// //         qr: enrichedQr, // ✅ THIS is the fix
// //         customer: o.customer || null,
// //         items: o.items || [],
// //         placedAt: o.placedAt ?? null,
// //         createdAt: o.createdAt ?? null,
// //         updatedAt: o.updatedAt ?? null,
// //         readyAt: o.readyAt ?? null,
// //         servedAt: o.servedAt ?? null,
// //       };

// //       if (bucket === "active") active.push(mapped);
// //       else if (bucket === "completed") completed.push(mapped);
// //       else cancelled.push(mapped);
// //     }

// //     return res.status(200).json({
// //       shift: {
// //         tz,
// //         from: startTz.toISO(),
// //         to: endTz.toISO(),
// //         label,
// //       },
// //       counts: {
// //         active: active.length,
// //         completed: completed.length,
// //         cancelled: cancelled.length,
// //         total: orders.length,
// //       },
// //       active,
// //       completed,
// //       cancelled,
// //     });
// //   } catch (err) {
// //     console.error("getKdsOverview error:", err);
// //     return res.status(500).json({ error: err.message || "Server error" });
// //   }
// // };
// // export const getKdsOverview = async (req, res) => {
// //   try {
// //     const branchId = String(req.query.branchId || "").trim();
// //     if (!branchId) return res.status(400).json({ error: "Missing branchId" });

// //     const branch = await Branch.findOne({ branchId }).lean();
// //     if (!branch) return res.status(404).json({ error: "Branch not found" });

// //     const tz = String(branch.timeZone || req.query.tz || "Asia/Bahrain").trim();
// //     const openingHours = branch.openingHours || {};

// //     const { startTz, endTz, label } = resolveCurrentShiftWindow({ openingHours, tz });

// //     const fromUtc = startTz.toUTC().toJSDate();
// //     const toUtc = endTz.toUTC().toJSDate();

// //     const timeQuery = {
// //       $or: [
// //         { placedAt: { $gte: fromUtc, $lt: toUtc } },
// //         { createdAt: { $gte: fromUtc, $lt: toUtc } },
// //       ],
// //     };

// //     // ✅ AUTO SERVE: READY -> SERVED after 60s
// //     // Works because KDS polls this endpoint regularly.
// //     const now = new Date();
// //     const cutoff = new Date(now.getTime() - 60 * 1000);

// //     // Only within this branch + shift window
// //     await Order.updateMany(
// //       {
// //         branchId,
// //         ...timeQuery,
// //         status: "Ready",
// //         readyAt: { $exists: true, $lte: cutoff },
// //       },
// //       {
// //         $set: { status: "Served", servedAt: now },
// //       }
// //     );

// //     const orders = await Order.find({
// //       branchId,
// //       ...timeQuery,
// //     })
// //       .sort({ createdAt: -1 })
// //       .limit(500)
// //       .lean();
    
// //     const qrIds = [
// //   ...new Set(
// //     orders
// //       .map((o) => o?.qr?.qrId)
// //       .filter(Boolean)
// //       .map(String)
// //   ),
// // ];

// // let qrMap = {};
// // if (qrIds.length) {
// //   const qrs = await Qr.find(
// //     { qrId: { $in: qrIds } },
// //     { qrId: 1, label: 1, type: 1, number: 1 }
// //   ).lean();

// //   qrMap = qrs.reduce((acc, q) => {
// //     acc[String(q.qrId)] = q;
// //     return acc;
// //   }, {});
// // }

// //     const active = [];
// //     const completed = [];
// //     const cancelled = [];

// //     for (const o of orders) {
// //       const bucket = classifyStatus(o.status);
// //       const mapped = {
// //         id: String(o._id),
// //         orderNumber: o.orderNumber,
// //         tokenNumber: o.tokenNumber ?? null,
// //         status: o.status || "Pending",
// //         branchId: o.branchId,
// //         currency: o.currency,
// //         pricing: o.pricing || null,
// //         qr: o.qr || null,
// //         customer: o.customer || null,
// //         items: o.items || [],
// //         placedAt: o.placedAt ?? null,
// //         createdAt: o.createdAt ?? null,
// //         updatedAt: o.updatedAt ?? null,

// //         // optional useful fields
// //         readyAt: o.readyAt ?? null,
// //         servedAt: o.servedAt ?? null,
// //       };

// //       if (bucket === "active") active.push(mapped);
// //       else if (bucket === "completed") completed.push(mapped);
// //       else cancelled.push(mapped);
// //     }

// //     return res.status(200).json({
// //       shift: {
// //         tz,
// //         from: startTz.toISO(),
// //         to: endTz.toISO(),
// //         label,
// //       },
// //       counts: {
// //         active: active.length,
// //         completed: completed.length,
// //         cancelled: cancelled.length,
// //         total: orders.length,
// //       },
// //       active,
// //       completed,
// //       cancelled,
// //     });
// //   } catch (err) {
// //     console.error("getKdsOverview error:", err);
// //     return res.status(500).json({ error: err.message || "Server error" });
// //   }
// // };

// /**
//  * PATCH /api/kds/orders/:id/status
//  * Body: { status: "READY" | "Ready" | "Preparing" ... , branchId? }
//  */

// // -------------------- helpers --------------------
// function computeOverallStatusFromCycles(kitchenCycles) {
//   const cycles = Array.isArray(kitchenCycles) ? kitchenCycles : [];

//   const lineStatuses = [];
//   for (const c of cycles) {
//     const items = Array.isArray(c?.items) ? c.items : [];
//     for (const it of items) {
//       const s = toCode(it?.lineStatus || "");
//       if (s) lineStatuses.push(s);
//     }
//   }

//   if (lineStatuses.length === 0) return "";

//   // Priority rules (highest first)
//   if (lineStatuses.includes("PREPARING")) return "PREPARING";
//   if (lineStatuses.includes("PENDING")) return "PENDING";
//   if (lineStatuses.includes("READY")) return "READY";
//   if (lineStatuses.every((s) => s === "SERVED")) return "SERVED";
//   if (lineStatuses.includes("SERVED")) return "SERVED";

//   return "";
// }


// // -------------------- controller --------------------

// /**
//  * PATCH /api/kds/orders/:id/status
//  * Body: { status: "PREPARING" | "READY" | "SERVED" | "COMPLETED" | "REJECTED" | label, branchId }
//  */
// export const updateKdsOrderStatus = async (req, res) => {
//   try {
//     const orderId = String(req.params.id || "").trim();
//     const { status, branchId } = req.body || {};

//     if (!mongoose.Types.ObjectId.isValid(orderId)) {
//       return res.status(400).json({ error: "Invalid order id" });
//     }
//     if (!branchId) return res.status(400).json({ error: "Missing branchId" });

//     // Accept code or label from client
//     const nextLabel = toLabel(status); // returns "Preparing"/"Ready"/...
//     if (!nextLabel) return res.status(400).json({ error: "Invalid status value" });

//     const order = await Order.findOne({
//       _id: orderId,
//       branchId: String(branchId).trim(),
//     });

//     if (!order) return res.status(404).json({ error: "Order not found" });

//     // Transition rule check (uses your existing rules)
//     if (!canTransition(order.status, nextLabel)) {
//       return res.status(400).json({
//         error: "Invalid status transition",
//         from: order.status,
//         to: nextLabel,
//       });
//     }

//     // Ensure kitchenCycles exists + fix missing "cycle" field (your schema requires it)
//     if (!Array.isArray(order.kitchenCycles)) order.kitchenCycles = [];
//     if (order.kitchenCycles.length === 0) {
//       order.kitchenCycles.push({
//         cycle: Number(order.kitchenCycle || 1) || 1,
//         items: [],
//       });
//     }

//     // Active cycle number
//     const activeCycleNo = Number(order.kitchenCycle || 1) || 1;

//     // Find or create active cycle doc
//     let activeCycle = order.kitchenCycles.find(
//       (c) => Number(c?.cycle) === activeCycleNo
//     );

//     if (!activeCycle) {
//       activeCycle = { cycle: activeCycleNo, items: [] };
//       order.kitchenCycles.push(activeCycle);
//     }

//     if (!Array.isArray(activeCycle.items)) activeCycle.items = [];

//     const nextCode = toCode(nextLabel); // e.g. "PREPARING"
//     const now = new Date();

//     // Update per-line statuses in active cycle for kitchen flow
//     if (nextCode === "PREPARING") {
//       for (const it of activeCycle.items) {
//         const cur = toCode(it?.lineStatus || "PENDING");
//         if (cur === "" || cur === "PENDING") it.lineStatus = "PREPARING";
//       }
//     } else if (nextCode === "READY") {
//       for (const it of activeCycle.items) {
//         const cur = toCode(it?.lineStatus || "PENDING");
//         if (cur === "PENDING" || cur === "PREPARING") it.lineStatus = "READY";
//       }
//       order.readyAt = now;
//       order.readyAtCycle = activeCycleNo; // ✅ so your auto-serve logic works
//     } else if (nextCode === "SERVED") {
//       for (const it of activeCycle.items) {
//         const cur = toCode(it?.lineStatus || "PENDING");
//         if (cur === "PENDING" || cur === "PREPARING" || cur === "READY") {
//           it.lineStatus = "SERVED";
//         }
//       }
//       order.servedAt = now;
//     } else if (nextCode === "COMPLETED") {
//       // nothing required on lines
//     } else if (nextCode === "REJECTED" || nextCode === "CANCELLED") {
//       // nothing required on lines
//     }

//     // Set order.status (your system uses Title Case labels)
//     order.status = nextLabel;

//     // Optionally keep overall consistent with cycles (only if helper returns something)
//     const computed = computeOverallStatusFromCycles(order.kitchenCycles);
//     if (computed && !isTerminal(order.status)) {
//       const computedLabel = STATUS_CODE_TO_LABEL[computed] || order.status;
//       order.status = computedLabel;
//     }

//     // bump revision (your frontend uses it for UPDATED)
//     order.revision = Number(order.revision || 0) + 1;

//     await order.save();

//     return res.status(200).json({
//       message: "Status updated",
//       order: {
//         id: String(order._id),
//         status: order.status,
//         revision: order.revision ?? 0,
//         kitchenCycle: order.kitchenCycle ?? 1,
//         readyAt: order.readyAt ?? null,
//         servedAt: order.servedAt ?? null,
//       },
//     });
//   } catch (err) {
//     console.error("updateKdsOrderStatus error:", err);
//     return res.status(500).json({ error: err.message || "Server error" });
//   }
// };



// export const updateKdsOrderStatus = async (req, res) => {
//   try {
//     const id = String(req.params.id || "").trim();
//     const incoming = String(req.body?.status || "").trim();
//     if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid order id" });
//     if (!incoming) return res.status(400).json({ error: "Missing status" });

//     const branchId = String(req.body?.branchId || req.query.branchId || "").trim();
//     const nextStatusLabel = toLabel(incoming);
//     if (!nextStatusLabel) return res.status(400).json({ error: "Invalid status value" });

//     const order = await Order.findById(id);
//     if (!order) return res.status(404).json({ error: "Order not found" });

//     if (branchId && String(order.branchId || "") !== branchId) {
//       return res.status(403).json({ error: "Branch mismatch" });
//     }

//     // ensure exists
//     order.kitchenCycle = Number(order.kitchenCycle || 1) || 1;
//     order.kitchenCycles = Array.isArray(order.kitchenCycles) ? order.kitchenCycles : [];
//     order.revision = Number(order.revision || 0) || 0;
//     order.servedHistory = Array.isArray(order.servedHistory) ? order.servedHistory : [];

//     const now = new Date();
//     const nextCode = toCode(nextStatusLabel);

//     // find current cycle
//     const currentCycleNumber = order.kitchenCycle;
//     const idx = order.kitchenCycles.findIndex((c) => Number(c.cycle) === Number(currentCycleNumber));
//     if (idx === -1) {
//       return res.status(409).json({ error: "Current kitchen cycle not found", kitchenCycle: currentCycleNumber });
//     }

//     const cycle = order.kitchenCycles[idx];
//     const prevCycleStatus = toLabel(cycle.status);

//     // ✅ update cycle status
//     cycle.status = nextCode;
//     cycle.updatedAt = now;

//     // ✅ update timestamps and item kitchenStatus in this cycle
//     if (nextCode === "PREPARING") {
//       cycle.readyAt = null;
//       cycle.servedAt = null;

//       for (const it of (cycle.items || [])) {
//         it.kitchenStatus = "PREPARING";
//         it.readyAt = null;
//         it.servedAt = null;
//       }
//     }

//     if (nextCode === "READY") {
//       cycle.readyAt = now;
//       cycle.servedAt = null;

//       for (const it of (cycle.items || [])) {
//         it.kitchenStatus = "READY";
//         it.readyAt = now;
//         it.servedAt = null;
//       }
//     }

//     if (nextCode === "SERVED") {
//       cycle.servedAt = now;

//       for (const it of (cycle.items || [])) {
//         it.kitchenStatus = "SERVED";
//         it.servedAt = now;
//       }

//       // audit
//       order.servedHistory.push({
//         kitchenCycle: currentCycleNumber,
//         servedAt: now,
//         readyAt: cycle.readyAt ?? null,
//         fromStatus: prevCycleStatus || null,
//       });
//     }

//     // ✅ recompute overall status from cycles
//     order.status = computeOverallStatusFromCycles(order.kitchenCycles);

//     // Optional overall timestamps:
//     // - overall readyAt = latest cycle readyAt when overall becomes Ready
//     // - overall servedAt = now only if ALL cycles served
//     const allCodes = order.kitchenCycles.map((c) => toCode(c.status));
//     if (order.status === "Ready") {
//       // pick current cycle readyAt
//       order.readyAt = cycle.readyAt ?? now;
//       order.servedAt = null;
//     } else if (allCodes.length > 0 && allCodes.every((x) => x === "SERVED")) {
//       order.servedAt = now;
//     } else {
//       // keep these clean if not meaningful
//       if (order.status !== "Ready") order.readyAt = null;
//       if (order.status !== "Served") order.servedAt = null;
//     }

//     // ✅ bump revision for KDS action
//     order.revision += 1;

//     // ✅ keep legacy items synced (flatten cycles)
//     order.items = flattenCyclesToLegacyItems(order.kitchenCycles);

//     await order.save();

//     return res.status(200).json({
//       message: "Status updated",
//       order: {
//         id: String(order._id),
//         status: order.status,
//         revision: order.revision ?? 0,
//         kitchenCycle: order.kitchenCycle ?? 1,
//         kitchenCycles: order.kitchenCycles ?? [],
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

// export const updateKdsOrderStatus = async (req, res) => {
//   try {
//     const id = String(req.params.id || "").trim();
//     const incoming = String(req.body?.status || "").trim();

//     if (!mongoose.Types.ObjectId.isValid(id)) {
//       return res.status(400).json({ error: "Invalid order id" });
//     }
//     if (!incoming) return res.status(400).json({ error: "Missing status" });

//     const branchId = String(req.body?.branchId || req.query.branchId || "").trim();

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

//     // ✅ transition rules (MUST allow PENDING -> PREPARING)
//     // Ensure your canTransition supports this.
//     // Example rule tweak:
//     // PENDING: ["PREPARING","REJECTED","CANCELLED"]
//     if (!canTransition(currentLabel, nextStatusLabel)) {
//       return res.status(409).json({
//         error: "Invalid status transition",
//         from: currentLabel,
//         to: nextStatusLabel,
//       });
//     }

//     const nextCode = toCode(nextStatusLabel);
//     const now = new Date();

//     // ensure fields exist (safe)
//     order.revision = Number(order.revision || 0) || 0;
//     order.kitchenCycle = Number(order.kitchenCycle || 1) || 1;
//     order.servedHistory = Array.isArray(order.servedHistory) ? order.servedHistory : [];

//     const prevLabel = String(order.status || "").trim();

//     // ✅ apply status
//     order.status = nextStatusLabel;

//     // ✅ stamp/clear timestamps by status
//     if (nextCode === "PREPARING") {
//       // reopen/ensure clean kitchen state
//       order.readyAt = null;
//       order.servedAt = null;
//     }

//     if (nextCode === "READY") {
//        order.readyAt = now;
//        order.readyAtCycle = order.kitchenCycle || 1; // ✅ tie ready time to current cycle
//        order.servedAt = null;
//     }

//     if (nextCode === "SERVED") {
//       order.servedAt = now;

//       // optional history entry
//       order.servedHistory.push({
//         kitchenCycle: order.kitchenCycle,
//         servedAt: now,
//         readyAt: order.readyAt ?? null,
//         fromStatus: prevLabel || null,
//       });
//     }

//     // ✅ bump revision when KDS changes status
//     order.revision += 1;

//     await order.save();

//     return res.status(200).json({
//       message: "Status updated",
//       order: {
//         id: String(order._id),
//         status: order.status,
//         revision: order.revision ?? 0,
//         kitchenCycle: order.kitchenCycle ?? 1,
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

// export const updateKdsOrderStatus = async (req, res) => {
//   try {
//     const id = String(req.params.id || "").trim();
//     const incoming = String(req.body?.status || "").trim();

//     if (!mongoose.Types.ObjectId.isValid(id)) {
//       return res.status(400).json({ error: "Invalid order id" });
//     }
//     if (!incoming) return res.status(400).json({ error: "Missing status" });

//     const branchId = String(req.body?.branchId || req.query.branchId || "").trim();

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


// // src/controllers/kdsController.js
// import { DateTime } from "luxon";
// import mongoose from "mongoose";
// import Branch from "../models/Branch.js";
// import Order from "../models/Order.js";

// /**
//  * openingHours example:
//  * {
//  *   "Mon":"09:00-01:00",
//  *   "Tue":"09:00-23:00",
//  *   ...
//  * }
//  */

// const DAY_KEYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// function parseRange(rangeStr) {
//   // "09:00-01:00"
//   const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(String(rangeStr || "").trim());
//   if (!m) return null;
//   return {
//     startH: Number(m[1]),
//     startM: Number(m[2]),
//     endH: Number(m[3]),
//     endM: Number(m[4]),
//   };
// }

// function buildShiftWindowForDay(baseDate, range, tz) {
//   // baseDate is DateTime at start of the day in tz
//   const start = baseDate.set({ hour: range.startH, minute: range.startM, second: 0, millisecond: 0 });
//   let end = baseDate.set({ hour: range.endH, minute: range.endM, second: 0, millisecond: 0 });

//   // cross midnight
//   if (end <= start) end = end.plus({ days: 1 });

//   return { start, end };
// }

// function getDayKey(dt) {
//   // Luxon: 1=Mon ... 7=Sun
//   return DAY_KEYS[dt.weekday - 1];
// }

// /**
//  * Returns the current active shift window in UTC based on openingHours.
//  * Handles:
//  * - normal same-day shift
//  * - cross-midnight shift
//  * - after-midnight still part of yesterday's shift
//  */
// function resolveCurrentShiftWindow({ openingHours, tz, now }) {
//   const nowTz = (now ? now.setZone(tz) : DateTime.now().setZone(tz));

//   const todayKey = getDayKey(nowTz);
//   const todayRange = parseRange(openingHours?.[todayKey]);

//   const todayBase = nowTz.startOf("day");
//   const todayWindow = todayRange ? buildShiftWindowForDay(todayBase, todayRange, tz) : null;

//   // Yesterday (for after-midnight case)
//   const yTz = nowTz.minus({ days: 1 });
//   const yKey = getDayKey(yTz);
//   const yRange = parseRange(openingHours?.[yKey]);
//   const yBase = yTz.startOf("day");
//   const yWindow = yRange ? buildShiftWindowForDay(yBase, yRange, tz) : null;

//   // 1) If we are still inside yesterday shift (commonly after midnight), use yesterday window.
//   if (yWindow && nowTz >= yWindow.start && nowTz < yWindow.end) {
//     return {
//       startTz: yWindow.start,
//       endTz: yWindow.end,
//       label: `${yKey} ${yWindow.start.toFormat("HH:mm")} → ${getDayKey(yWindow.end)} ${yWindow.end.toFormat("HH:mm")}`,
//     };
//   }

//   // 2) Otherwise use today's window if exists.
//   if (todayWindow) {
//     // If now is before today's start (e.g. 06:00 but opens at 09:00), we still return today's window
//     // so KDS shows empty but correct “upcoming shift”.
//     return {
//       startTz: todayWindow.start,
//       endTz: todayWindow.end,
//       label: `${todayKey} ${todayWindow.start.toFormat("HH:mm")} → ${getDayKey(todayWindow.end)} ${todayWindow.end.toFormat("HH:mm")}`,
//     };
//   }

//   // 3) Fallback: calendar day
//   const start = nowTz.startOf("day");
//   const end = start.plus({ days: 1 });
//   return {
//     startTz: start,
//     endTz: end,
//     label: `${todayKey} ${start.toFormat("HH:mm")} → ${getDayKey(end)} ${end.toFormat("HH:mm")}`,
//   };
// }

// function normalizeStatus(s) {
//   return String(s || "").trim().toLowerCase();
// }

// function classifyStatus(raw) {
//   const s = normalizeStatus(raw);

//   // Active (same tab): pending + accepted
//   if (["pending", "accepted"].includes(s)) return "active";

//   // Completed group (payment done etc.)
//   if (["completed", "paid", "closed", "delivered"].includes(s)) return "completed";

//   // Cancelled group
//   if (["cancelled", "canceled", "void"].includes(s)) return "cancelled";

//   // default: active (safe)
//   return "active";
// }

// /**
//  * GET /api/kds/overview?branchId=BR-000004
//  */
// export const getKdsOverview = async (req, res) => {
//   try {
//     const branchId = String(req.query.branchId || "").trim();
//     if (!branchId) return res.status(400).json({ error: "Missing branchId" });

//     // Load branch to get openingHours + tz
//     const branch = await Branch.findOne({ branchId }).lean();
//     if (!branch) return res.status(404).json({ error: "Branch not found" });

//     const tz = String(branch.timeZone || req.query.tz || "Asia/Bahrain").trim();
//     const openingHours = branch.openingHours || {};

//     const { startTz, endTz, label } = resolveCurrentShiftWindow({
//       openingHours,
//       tz,
//     });

//     const fromUtc = startTz.toUTC().toJSDate();
//     const toUtc = endTz.toUTC().toJSDate();

//     // We prefer placedAt for business flow
//     // fallback: if old data doesn't have placedAt, createdAt exists (timestamps)
//     const timeQuery = {
//       $or: [
//         { placedAt: { $gte: fromUtc, $lt: toUtc } },
//         { createdAt: { $gte: fromUtc, $lt: toUtc } },
//       ],
//     };

//     // Query all orders for the shift
//     const orders = await Order.find({
//       branchId,
//       ...timeQuery,
//     })
//       .sort({ createdAt: -1 })
//       .limit(500)
//       .lean();

//     const active = [];
//     const completed = [];
//     const cancelled = [];

//     for (const o of orders) {
//       const bucket = classifyStatus(o.status);
//       const mapped = {
//         id: String(o._id),
//         orderNumber: o.orderNumber,
//         tokenNumber: o.tokenNumber ?? null,
//         status: o.status || "Pending",
//         branchId: o.branchId,
//         currency: o.currency,
//         pricing: o.pricing || null,
//         qr: o.qr || null,
//         customer: o.customer || null,
//         items: o.items || [],
//         placedAt: o.placedAt ?? null,
//         createdAt: o.createdAt ?? null,
//         updatedAt: o.updatedAt ?? null,
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
//       counts: {
//         active: active.length,
//         completed: completed.length,
//         cancelled: cancelled.length,
//         total: orders.length,
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
//  * Body: { status: "Accepted" | "Completed" | "Cancelled" }
//  */

// export const updateKdsOrderStatus = async (req, res) => {
//   try {
//     const id = String(req.params.id || "").trim();
//     const incoming = String(req.body?.status || "").trim(); // can be code or label

//     if (!mongoose.Types.ObjectId.isValid(id)) {
//       return res.status(400).json({ error: "Invalid order id" });
//     }
//     if (!incoming) return res.status(400).json({ error: "Missing status" });

//     // Optional branch guard
//     const branchId = String(req.body?.branchId || req.query.branchId || "").trim();

//     // ✅ Accept both CODE and LABEL
//     const STATUS_CODE_TO_LABEL = {
//       PENDING: "Pending",
//       ACCEPTED: "Accepted",
//       PREPARING: "Preparing",
//       READY: "Ready",
//       SERVED: "Served",
//       COMPLETED: "Completed",
//       CANCELLED: "Cancelled",
//       REJECTED: "Rejected",
//     };

//     // helper: normalize string to CODE (e.g. "In Progress" -> "IN_PROGRESS")
//     const toCode = (s) =>
//       String(s || "")
//         .trim()
//         .toUpperCase()
//         .replace(/\s+/g, "_");

//     // helper: normalize string to LABEL (Title Case based on lookup)
//     const toLabel = (s) => {
//       const code = toCode(s);
//       // if user sent a code
//       if (STATUS_CODE_TO_LABEL[code]) return STATUS_CODE_TO_LABEL[code];

//       // if user sent a label like "Preparing"
//       // try matching by label values:
//       const found = Object.values(STATUS_CODE_TO_LABEL).find(
//         (lbl) => toCode(lbl) === code
//       );
//       return found || null;
//     };

//     const nextStatusLabel = toLabel(incoming);
//     if (!nextStatusLabel) {
//       return res.status(400).json({ error: "Invalid status value" });
//     }

//     const order = await Order.findById(id);
//     if (!order) return res.status(404).json({ error: "Order not found" });

//     if (branchId && String(order.branchId || "") !== branchId) {
//       return res.status(403).json({ error: "Branch mismatch" });
//     }

//     // ✅ Transition protection
//     const current = normalizeStatus(order.status); // your existing helper
//     const target = normalizeStatus(nextStatusLabel);

//     const closed = new Set(["completed", "cancelled", "canceled", "paid", "closed", "delivered", "rejected"]);
//     if (closed.has(current) && current !== target) {
//       return res.status(409).json({ error: "Order already closed" });
//     }

//     // ✅ Save label (keeps compatibility with existing overview filters)
//     order.status = nextStatusLabel;
//     await order.save();

//     return res.status(200).json({
//       message: "Status updated",
//       order: {
//         id: String(order._id),
//         status: order.status,
//         updatedAt: order.updatedAt ?? null,
//       },
//     });
//   } catch (err) {
//     console.error("updateKdsOrderStatus error:", err);
//     return res.status(500).json({ error: err.message || "Server error" });
//   }
// };


// // export const updateKdsOrderStatus = async (req, res) => {
// //   try {
// //     const id = String(req.params.id || "").trim();
// //     const nextStatus = String(req.body?.status || "").trim();

// //     if (!mongoose.Types.ObjectId.isValid(id)) {
// //       return res.status(400).json({ error: "Invalid order id" });
// //     }
// //     if (!nextStatus) return res.status(400).json({ error: "Missing status" });

// //     // Optional branch guard: require branchId in body/query and match the order
// //     const branchId = String(req.body?.branchId || req.query.branchId || "").trim();

// //     const allowed = new Set(["Pending", "Accepted", "Completed", "Cancelled"]);
// //     if (!allowed.has(nextStatus)) {
// //       return res.status(400).json({ error: "Invalid status value" });
// //     }

// //     const order = await Order.findById(id);
// //     if (!order) return res.status(404).json({ error: "Order not found" });

// //     if (branchId && String(order.branchId || "") !== branchId) {
// //       return res.status(403).json({ error: "Branch mismatch" });
// //     }

// //     // Basic transition protection (real-world)
// //     const current = normalizeStatus(order.status);
// //     const target = normalizeStatus(nextStatus);

// //     const closed = new Set(["completed", "cancelled", "canceled", "paid", "closed", "delivered"]);
// //     if (closed.has(current) && current !== target) {
// //       return res.status(409).json({ error: "Order already closed" });
// //     }

// //     order.status = nextStatus;
// //     await order.save();

// //     return res.status(200).json({
// //       message: "Status updated",
// //       order: {
// //         id: String(order._id),
// //         status: order.status,
// //         updatedAt: order.updatedAt ?? null,
// //       },
// //     });
// //   } catch (err) {
// //     console.error("updateKdsOrderStatus error:", err);
// //     return res.status(500).json({ error: err.message || "Server error" });
// //   }



// // };
