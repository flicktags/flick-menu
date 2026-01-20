// src/controllers/kdsController.js
import { DateTime } from "luxon";
import mongoose from "mongoose";
import Branch from "../models/Branch.js";
import Order from "../models/Order.js";

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

function buildShiftWindowForDay(baseDate, range, tz) {
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

  // ✅ Active tab should include your kitchen flow
  if (["pending", "accepted", "preparing", "ready"].includes(s)) return "active";

  // ✅ Completed tab
  if (["served", "completed", "paid", "closed", "delivered"].includes(s)) return "completed";

  // ✅ Cancelled tab
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

  // try match by label value
  const found = Object.values(STATUS_CODE_TO_LABEL).find((lbl) => toCode(lbl) === code);
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
    PENDING: new Set(["ACCEPTED", "REJECTED", "CANCELLED"]),
    ACCEPTED: new Set(["PREPARING", "CANCELLED"]),
    PREPARING: new Set(["READY", "CANCELLED"]),
    READY: new Set(["SERVED"]), // you can keep manual serve allowed, but mostly auto
    SERVED: new Set(["COMPLETED"]),
    // COMPLETED/CANCELLED/REJECTED are terminal handled above
  };

  const allowed = rules[cur];
  if (!allowed) return false;
  return allowed.has(nxt);
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

    // ✅ AUTO SERVE: READY -> SERVED after 60s
    // Works because KDS polls this endpoint regularly.
    const now = new Date();
    const cutoff = new Date(now.getTime() - 60 * 1000);

    // Only within this branch + shift window
    await Order.updateMany(
      {
        branchId,
        ...timeQuery,
        status: "Ready",
        readyAt: { $exists: true, $lte: cutoff },
      },
      {
        $set: { status: "Served", servedAt: now },
      }
    );

    const orders = await Order.find({
      branchId,
      ...timeQuery,
    })
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    const active = [];
    const completed = [];
    const cancelled = [];

    for (const o of orders) {
      const bucket = classifyStatus(o.status);
      const mapped = {
        id: String(o._id),
        orderNumber: o.orderNumber,
        tokenNumber: o.tokenNumber ?? null,
        status: o.status || "Pending",
        branchId: o.branchId,
        currency: o.currency,
        pricing: o.pricing || null,
        qr: o.qr || null,
        customer: o.customer || null,
        items: o.items || [],
        placedAt: o.placedAt ?? null,
        createdAt: o.createdAt ?? null,
        updatedAt: o.updatedAt ?? null,

        // optional useful fields
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

/**
 * PATCH /api/kds/orders/:id/status
 * Body: { status: "READY" | "Ready" | "Preparing" ... , branchId? }
 */
export const updateKdsOrderStatus = async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const incoming = String(req.body?.status || "").trim();

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid order id" });
    }
    if (!incoming) return res.status(400).json({ error: "Missing status" });

    const branchId = String(req.body?.branchId || req.query.branchId || "").trim();

    const nextStatusLabel = toLabel(incoming);
    if (!nextStatusLabel) {
      return res.status(400).json({ error: "Invalid status value" });
    }

    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ error: "Order not found" });

    if (branchId && String(order.branchId || "") !== branchId) {
      return res.status(403).json({ error: "Branch mismatch" });
    }

    const currentLabel = String(order.status || "Pending").trim();

    // ✅ transition rules
    if (!canTransition(currentLabel, nextStatusLabel)) {
      return res.status(409).json({
        error: "Invalid status transition",
        from: currentLabel,
        to: nextStatusLabel,
      });
    }

    // ✅ If moving to READY, stamp readyAt
    const nextCode = toCode(nextStatusLabel);
    const now = new Date();

    order.status = nextStatusLabel;

    if (nextCode === "READY") {
      // Only set if not already set
      if (!order.readyAt) order.readyAt = now;
    }

    if (nextCode === "SERVED") {
      if (!order.servedAt) order.servedAt = now;
    }

    await order.save();

    return res.status(200).json({
      message: "Status updated",
      order: {
        id: String(order._id),
        status: order.status,
        readyAt: order.readyAt ?? null,
        servedAt: order.servedAt ?? null,
        updatedAt: order.updatedAt ?? null,
      },
    });
  } catch (err) {
    console.error("updateKdsOrderStatus error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};


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
