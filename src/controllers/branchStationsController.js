// src/controllers/branchStationsController.js
import crypto from "crypto";
import bcrypt from "bcryptjs";

import Branch from "../models/Branch.js";
import { assertUserOwnsBranch } from "../utils/branchOwnership.js";
import { touchBranchMenuStampByBizId } from "../utils/touchMenuStamp.js"; // same helper you use

// -------------------- helpers --------------------
const asStr = (v, def = "") => (v == null ? def : String(v));
const asInt = (v, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
};

const WEAK_PINS = new Set([
  "0000",
  "1111",
  "2222",
  "3333",
  "4444",
  "5555",
  "6666",
  "7777",
  "8888",
  "9999",
  "1234",
  "2345",
  "3456",
  "4567",
  "5678",
  "6789",
  "9876",
  "8765",
  "7654",
  "6543",
  "5432",
  "4321",
  "1122",
  "2211",
  "1212",
  "2000",
]);

function isSequential(pin) {
  const s = pin;
  let asc = true,
    desc = true;
  for (let i = 1; i < s.length; i++) {
    const prev = s.charCodeAt(i - 1);
    const cur = s.charCodeAt(i);
    if (cur !== prev + 1) asc = false;
    if (cur !== prev - 1) desc = false;
  }
  return asc || desc;
}

function validateStrongPin(pinRaw) {
  const pin = String(pinRaw ?? "").trim();

  if (!pin) return { ok: false, reason: "PIN is required" };

  // digits only
  if (!/^\d+$/.test(pin)) {
    return { ok: false, reason: "PIN must contain digits only" };
  }

  // 4..8 digits
  if (pin.length < 4 || pin.length > 8) {
    return { ok: false, reason: "PIN must be 4 to 8 digits" };
  }

  if (WEAK_PINS.has(pin)) {
    return { ok: false, reason: "PIN is too weak" };
  }

  // all-same digits
  if (/^(\d)\1+$/.test(pin)) {
    return { ok: false, reason: "PIN is too weak" };
  }

  // sequential
  if (pin.length >= 4 && isSequential(pin)) {
    return { ok: false, reason: "PIN is too weak" };
  }

  return { ok: true };
}

async function hashPin(pin) {
  const saltRounds = 10;
  return bcrypt.hash(pin, saltRounds);
}

function makeStationId() {
  // ST- + 6 chars
  const rand = crypto.randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
  return `ST-${rand}`;
}

function normalizeKey(key) {
  return asStr(key).trim().toUpperCase().replace(/\s+/g, "_");
}

/**
 * ✅ Never leak PIN sensitive fields to clients.
 * We return: { ...station, hasPin: true/false } but no pinHash.
 */
function sanitizeStations(stations) {
  return (stations || []).map((s) => {
    // if mongoose subdoc -> plain object; else keep as is
    const obj = typeof s?.toObject === "function" ? s.toObject() : { ...s };

    const hasPin = !!(obj?.pinHash && String(obj.pinHash).trim().length > 0);

    delete obj.pinHash;
    delete obj.pinFailedCount;
    delete obj.pinLockUntil;

    obj.hasPin = hasPin;
    return obj;
  });
}

function sanitizeOneStation(st) {
  const obj = typeof st?.toObject === "function" ? st.toObject() : { ...st };
  const hasPin = !!(obj?.pinHash && String(obj.pinHash).trim().length > 0);

  delete obj.pinHash;
  delete obj.pinFailedCount;
  delete obj.pinLockUntil;

  obj.hasPin = hasPin;
  return obj;
}

// -------------------- controllers --------------------

/**
 * GET /api/vendor/branches/:branchId/stations
 */
export const getStations = async (req, res) => {
  try {
    const branchId = asStr(req.params.branchId).trim();
    if (!branchId) return res.status(400).json({ error: "branchId required" });

    const ok = await assertUserOwnsBranch(req, branchId);
    if (!ok) return res.status(403).json({ error: "Forbidden" });

    const branch = await Branch.findOne({ branchId })
      .select("branchId vendorId stations")
      .lean();

    if (!branch) return res.status(404).json({ error: "Branch not found" });

    return res.json({
      branchId: branch.branchId,
      vendorId: branch.vendorId,
      stations: sanitizeStations(branch.stations || []),
    });
  } catch (e) {
    console.error("[Stations][GET] error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * POST /api/vendor/branches/:branchId/stations
 * Body: { key, nameEnglish, nameArabic?, sortOrder?, isEnabled?, printers?, pin }
 *
 * ✅ PIN is mandatory on create.
 */
export const createStation = async (req, res) => {
  try {
    const branchId = asStr(req.params.branchId).trim();
    if (!branchId) return res.status(400).json({ error: "branchId required" });

    const ok = await assertUserOwnsBranch(req, branchId);
    if (!ok) return res.status(403).json({ error: "Forbidden" });

    const key = normalizeKey(req.body?.key);
    const nameEnglish = asStr(req.body?.nameEnglish).trim();
    const nameArabic = asStr(req.body?.nameArabic).trim();
    const sortOrder = asInt(req.body?.sortOrder, 0);
    const isEnabled =
      typeof req.body?.isEnabled === "boolean"
        ? req.body.isEnabled
        : asStr(req.body?.isEnabled).toLowerCase() === "true";

    // ✅ pin is mandatory
    const pin = asStr(req.body?.pin).trim();
    const vp = validateStrongPin(pin);
    if (!vp.ok) return res.status(400).json({ error: vp.reason || "Weak PIN" });

    if (!key) return res.status(400).json({ error: "key is required" });
    if (!nameEnglish)
      return res.status(400).json({ error: "nameEnglish is required" });
    if (key === "MAIN")
      return res.status(409).json({ error: "MAIN is reserved" });

    const branch = await Branch.findOne({ branchId }).select(
      "stations vendorId branchId"
    );
    if (!branch) return res.status(404).json({ error: "Branch not found" });

    branch.stations = Array.isArray(branch.stations) ? branch.stations : [];

    const exists = branch.stations.some((s) => normalizeKey(s.key) === key);
    if (exists)
      return res
        .status(409)
        .json({ error: "Station key already exists", key });

    // Generate unique stationId inside branch
    let stationId = makeStationId();
    const ids = new Set(branch.stations.map((s) => String(s.stationId || "")));
    let attempts = 0;
    while (ids.has(stationId) && attempts < 5) {
      stationId = makeStationId();
      attempts++;
    }
    if (ids.has(stationId)) {
      return res
        .status(500)
        .json({ error: "Could not generate unique stationId" });
    }

    const now = new Date();
    const pinHash = await hashPin(pin);

    const station = {
      stationId,
      key,
      nameEnglish,
      nameArabic,
      isEnabled: req.body?.isEnabled === undefined ? true : isEnabled,
      sortOrder,
      printers: Array.isArray(req.body?.printers)
        ? req.body.printers.map(String)
        : [],
      // ✅ new pin fields
      pinHash,
      pinUpdatedAt: now,
      pinFailedCount: 0,
      pinLockUntil: null,
      createdAt: now,
      updatedAt: now,
    };

    branch.stations.push(station);
    branch.stations.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    await branch.save();

    try {
      await touchBranchMenuStampByBizId(branchId);
    } catch (e) {
      console.warn("[Stations][POST] touch stamp failed:", e?.message);
    }

    return res.json({
      ok: true,
      station: sanitizeOneStation(station), // safe
      stations: sanitizeStations(branch.stations),
    });
  } catch (e) {
    console.error("[Stations][POST] error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * PUT /api/vendor/branches/:branchId/stations/:key
 * Body: { nameEnglish?, nameArabic?, sortOrder?, isEnabled?, printers?, pin? }
 *
 * ✅ PIN rules on update:
 * - If station currently has NO pinHash => pin is REQUIRED (mandatory)
 * - If body contains pin => validate + re-hash + reset lock counters
 * - MAIN: allow updating PIN (and optionally printers), but block renaming/enable toggles here
 */
export const updateStation = async (req, res) => {
  try {
    const branchId = asStr(req.params.branchId).trim();
    const key = normalizeKey(req.params.key);
    if (!branchId || !key)
      return res
        .status(400)
        .json({ error: "branchId and key are required" });

    const ok = await assertUserOwnsBranch(req, branchId);
    if (!ok) return res.status(403).json({ error: "Forbidden" });

    const isMain = key === "MAIN";

    const branch = await Branch.findOne({ branchId }).select("stations");
    if (!branch) return res.status(404).json({ error: "Branch not found" });

    const list = Array.isArray(branch.stations) ? branch.stations : [];
    const idx = list.findIndex((s) => normalizeKey(s.key) === key);
    if (idx === -1)
      return res.status(404).json({ error: "Station not found", key });

    const st = list[idx];
    const now = new Date();

    // ---------------- PIN handling ----------------
    const hasPinInBody = Object.prototype.hasOwnProperty.call(req.body || {}, "pin");
    const incomingPin = asStr(req.body?.pin).trim();
    const currentHasPin = !!(st.pinHash && String(st.pinHash).trim().length > 0);

    if (hasPinInBody) {
      const vp = validateStrongPin(incomingPin);
      if (!vp.ok)
        return res.status(400).json({ error: vp.reason || "Weak PIN" });

      st.pinHash = await hashPin(incomingPin);
      st.pinUpdatedAt = now;
      st.pinFailedCount = 0;
      st.pinLockUntil = null;
    } else {
      // mandatory only if station has no PIN yet
      if (!currentHasPin) {
        return res.status(400).json({ error: "PIN is required for this station" });
      }
    }

    // ---------------- normal updates ----------------
    // MAIN: do not allow changing name/isEnabled/sortOrder/key via this endpoint (keep MAIN stable)
    if (!isMain) {
      if (req.body?.nameEnglish !== undefined) {
        const v = asStr(req.body.nameEnglish).trim();
        if (!v)
          return res
            .status(400)
            .json({ error: "nameEnglish cannot be empty" });
        st.nameEnglish = v;
      }
      if (req.body?.nameArabic !== undefined)
        st.nameArabic = asStr(req.body.nameArabic).trim();

      if (req.body?.sortOrder !== undefined)
        st.sortOrder = asInt(req.body.sortOrder, st.sortOrder ?? 0);

      if (req.body?.isEnabled !== undefined) {
        st.isEnabled =
          typeof req.body.isEnabled === "boolean"
            ? req.body.isEnabled
            : asStr(req.body.isEnabled).toLowerCase() === "true";
      }
    }

    // printers: allow for all stations (including MAIN) if you want
    if (req.body?.printers !== undefined) {
      st.printers = Array.isArray(req.body.printers)
        ? req.body.printers.map(String)
        : [];
    }

    st.updatedAt = now;

    branch.stations = list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    await branch.save();

    try {
      await touchBranchMenuStampByBizId(branchId);
    } catch (e) {
      console.warn("[Stations][PUT] touch stamp failed:", e?.message);
    }

    return res.json({
      ok: true,
      station: sanitizeOneStation(st),
      stations: sanitizeStations(branch.stations),
    });
  } catch (e) {
    console.error("[Stations][PUT] error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * DELETE /api/vendor/branches/:branchId/stations/:key
 */
export const deleteStation = async (req, res) => {
  try {
    const branchId = asStr(req.params.branchId).trim();
    const key = normalizeKey(req.params.key);
    if (!branchId || !key)
      return res
        .status(400)
        .json({ error: "branchId and key are required" });

    const ok = await assertUserOwnsBranch(req, branchId);
    if (!ok) return res.status(403).json({ error: "Forbidden" });

    if (key === "MAIN")
      return res.status(409).json({ error: "MAIN cannot be deleted" });

    const branch = await Branch.findOne({ branchId }).select("stations");
    if (!branch) return res.status(404).json({ error: "Branch not found" });

    const before = (branch.stations || []).length;
    branch.stations = (branch.stations || []).filter(
      (s) => normalizeKey(s.key) !== key
    );

    if (branch.stations.length === before) {
      return res.status(404).json({ error: "Station not found", key });
    }

    await branch.save();

    try {
      await touchBranchMenuStampByBizId(branchId);
    } catch (e) {
      console.warn("[Stations][DELETE] touch stamp failed:", e?.message);
    }

    return res.json({ ok: true, stations: sanitizeStations(branch.stations) });
  } catch (e) {
    console.error("[Stations][DELETE] error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * PUT /api/vendor/branches/:branchId/stations/reorder
 * Body: { order: ["MAIN", "DINE_IN", "BAR"] }
 */
export const reorderStations = async (req, res) => {
  try {
    const branchId = asStr(req.params.branchId).trim();
    const order = req.body?.order;

    if (!branchId) return res.status(400).json({ error: "branchId required" });
    if (!Array.isArray(order) || order.length === 0) {
      return res.status(400).json({ error: "order array is required" });
    }

    const ok = await assertUserOwnsBranch(req, branchId);
    if (!ok) return res.status(403).json({ error: "Forbidden" });

    const branch = await Branch.findOne({ branchId }).select("stations");
    if (!branch) return res.status(404).json({ error: "Branch not found" });

    const list = Array.isArray(branch.stations) ? branch.stations : [];
    const map = new Map(list.map((s) => [normalizeKey(s.key), s]));

    const now = new Date();
    for (let i = 0; i < order.length; i++) {
      const k = normalizeKey(order[i]);
      const st = map.get(k);
      if (st) {
        st.sortOrder = i;
        st.updatedAt = now;
      }
    }

    const included = new Set(order.map((x) => normalizeKey(x)));
    const rest = list.filter((s) => !included.has(normalizeKey(s.key)));
    rest.forEach((s, idx) => {
      s.sortOrder = order.length + idx;
      s.updatedAt = now;
    });

    branch.stations = [...list].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    await branch.save();

    try {
      await touchBranchMenuStampByBizId(branchId);
    } catch (e) {
      console.warn("[Stations][REORDER] touch stamp failed:", e?.message);
    }

    return res.json({ ok: true, stations: sanitizeStations(branch.stations) });
  } catch (e) {
    console.error("[Stations][REORDER] error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
};


// // src/controllers/branchStationsController.js
// import crypto from "crypto";
// import Branch from "../models/Branch.js";
// import { assertUserOwnsBranch } from "../utils/branchOwnership.js";
// import { touchBranchMenuStampByBizId } from "../utils/touchMenuStamp.js"; // same helper you use
// import bcrypt from "bcryptjs";


// const asStr = (v, def = "") => (v == null ? def : String(v));
// const asInt = (v, def = 0) => {
//   const n = Number(v);
//   return Number.isFinite(n) ? Math.trunc(n) : def;
// };

// const WEAK_PINS = new Set([
//   "0000","1111","2222","3333","4444","5555","6666","7777","8888","9999",
//   "1234","2345","3456","4567","5678","6789",
//   "9876","8765","7654","6543","5432","4321",
//   "1122","2211","1212","2000"
// ]);

// function isSequential(pin) {
//   // checks 0123 / 1234 / 9876 etc
//   const s = pin;
//   let asc = true, desc = true;
//   for (let i = 1; i < s.length; i++) {
//     const prev = s.charCodeAt(i - 1);
//     const cur = s.charCodeAt(i);
//     if (cur !== prev + 1) asc = false;
//     if (cur !== prev - 1) desc = false;
//   }
//   return asc || desc;
// }

// function validateStrongPin(pinRaw) {
//   const pin = String(pinRaw ?? "").trim();

//   // ✅ digits only
//   if (!/^\d+$/.test(pin)) {
//     return { ok: false, reason: "PIN must contain digits only" };
//   }

//   // ✅ length (choose what you want: I recommend 6 for “strong”, but 4 is common)
//   // You can set this to 4..8 if you want:
//   if (pin.length < 4 || pin.length > 8) {
//     return { ok: false, reason: "PIN must be 4 to 8 digits" };
//   }

//   // ✅ reject common weak pins
//   if (WEAK_PINS.has(pin)) {
//     return { ok: false, reason: "PIN is too weak" };
//   }

//   // ✅ reject all-same digits (e.g., 7777)
//   if (/^(\d)\1+$/.test(pin)) {
//     return { ok: false, reason: "PIN is too weak" };
//   }

//   // ✅ reject sequential patterns
//   if (pin.length >= 4 && isSequential(pin)) {
//     return { ok: false, reason: "PIN is too weak" };
//   }

//   return { ok: true };
// }

// async function hashPin(pin) {
//   const saltRounds = 10;
//   return bcrypt.hash(pin, saltRounds);
// }

// function sanitizeStations(stations) {
//   return (stations || []).map((s) => {
//     const st = { ...s };
//     // remove sensitive fields
//     delete st.pinHash;
//     delete st.pinFailedCount;
//     delete st.pinLockUntil;

//     // provide safe indicator
//     st.hasPin = !!(s?.pinHash && String(s.pinHash).trim().length > 0);
//     return st;
//   });
// }



// function makeStationId() {
//   // ST- + 6 chars
//   const rand = crypto.randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
//   return `ST-${rand}`;
// }

// function normalizeKey(key) {
//   return asStr(key).trim().toUpperCase().replace(/\s+/g, "_");
// }

// /**
//  * GET /api/vendor/branches/:branchId/stations
//  */
// export const getStations = async (req, res) => {
//   try {
//     const branchId = asStr(req.params.branchId).trim();
//     if (!branchId) return res.status(400).json({ error: "branchId required" });

//     const ok = await assertUserOwnsBranch(req, branchId);
//     if (!ok) return res.status(403).json({ error: "Forbidden" });

//     const branch = await Branch.findOne({ branchId })
//       .select("branchId vendorId stations")
//       .lean();

//     if (!branch) return res.status(404).json({ error: "Branch not found" });

//     return res.json({
//       branchId: branch.branchId,
//       vendorId: branch.vendorId,
//       stations: branch.stations || [],
//     });
//   } catch (e) {
//     console.error("[Stations][GET] error:", e);
//     return res.status(500).json({ error: "Internal server error" });
//   }
// };

// /**
//  * POST /api/vendor/branches/:branchId/stations
//  * Body: { key, nameEnglish, nameArabic?, sortOrder?, isEnabled? }
//  */
// export const createStation = async (req, res) => {
//   try {
//     const branchId = asStr(req.params.branchId).trim();
//     if (!branchId) return res.status(400).json({ error: "branchId required" });

//     const ok = await assertUserOwnsBranch(req, branchId);
//     if (!ok) return res.status(403).json({ error: "Forbidden" });

//     const key = normalizeKey(req.body?.key);
//     const nameEnglish = asStr(req.body?.nameEnglish).trim();
//     const nameArabic = asStr(req.body?.nameArabic).trim();
//     const sortOrder = asInt(req.body?.sortOrder, 0);
//     const isEnabled =
//       typeof req.body?.isEnabled === "boolean"
//         ? req.body.isEnabled
//         : asStr(req.body?.isEnabled).toLowerCase() === "true";

//     if (!key) return res.status(400).json({ error: "key is required" });
//     if (!nameEnglish) return res.status(400).json({ error: "nameEnglish is required" });
//     if (key === "MAIN") return res.status(409).json({ error: "MAIN is reserved" });

//     const branch = await Branch.findOne({ branchId }).select("stations vendorId branchId");
//     if (!branch) return res.status(404).json({ error: "Branch not found" });

//     branch.stations = Array.isArray(branch.stations) ? branch.stations : [];

//     const exists = branch.stations.some((s) => normalizeKey(s.key) === key);
//     if (exists) return res.status(409).json({ error: "Station key already exists", key });

//     // Generate unique stationId inside branch
//     let stationId = makeStationId();
//     const ids = new Set(branch.stations.map((s) => String(s.stationId || "")));
//     let attempts = 0;
//     while (ids.has(stationId) && attempts < 5) {
//       stationId = makeStationId();
//       attempts++;
//     }
//     if (ids.has(stationId)) {
//       return res.status(500).json({ error: "Could not generate unique stationId" });
//     }

//     const now = new Date();
//     const station = {
//       stationId,
//       key,
//       nameEnglish,
//       nameArabic,
//       isEnabled: req.body?.isEnabled === undefined ? true : isEnabled,
//       sortOrder,
//       printers: Array.isArray(req.body?.printers) ? req.body.printers.map(String) : [],
//       createdAt: now,
//       updatedAt: now,
//     };

//     branch.stations.push(station);
//     branch.stations.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

//     await branch.save();

//     try {
//       await touchBranchMenuStampByBizId(branchId);
//     } catch (e) {
//       console.warn("[Stations][POST] touch stamp failed:", e?.message);
//     }

//     return res.json({ ok: true, station, stations: branch.stations });
//   } catch (e) {
//     console.error("[Stations][POST] error:", e);
//     return res.status(500).json({ error: "Internal server error" });
//   }
// };

// /**
//  * PUT /api/vendor/branches/:branchId/stations/:key
//  * Body: { nameEnglish?, nameArabic?, sortOrder?, isEnabled?, printers? }
//  */
// export const updateStation = async (req, res) => {
//   try {
//     const branchId = asStr(req.params.branchId).trim();
//     const key = normalizeKey(req.params.key);
//     if (!branchId || !key) return res.status(400).json({ error: "branchId and key are required" });

//     const ok = await assertUserOwnsBranch(req, branchId);
//     if (!ok) return res.status(403).json({ error: "Forbidden" });

//     if (key === "MAIN") return res.status(409).json({ error: "MAIN cannot be modified here" });

//     const branch = await Branch.findOne({ branchId }).select("stations");
//     if (!branch) return res.status(404).json({ error: "Branch not found" });

//     const list = Array.isArray(branch.stations) ? branch.stations : [];
//     const idx = list.findIndex((s) => normalizeKey(s.key) === key);
//     if (idx === -1) return res.status(404).json({ error: "Station not found", key });

//     const st = list[idx];
//     const now = new Date();

//     if (req.body?.nameEnglish !== undefined) {
//       const v = asStr(req.body.nameEnglish).trim();
//       if (!v) return res.status(400).json({ error: "nameEnglish cannot be empty" });
//       st.nameEnglish = v;
//     }
//     if (req.body?.nameArabic !== undefined) st.nameArabic = asStr(req.body.nameArabic).trim();
//     if (req.body?.sortOrder !== undefined) st.sortOrder = asInt(req.body.sortOrder, st.sortOrder ?? 0);
//     if (req.body?.isEnabled !== undefined) {
//       st.isEnabled =
//         typeof req.body.isEnabled === "boolean"
//           ? req.body.isEnabled
//           : asStr(req.body.isEnabled).toLowerCase() === "true";
//     }
//     if (req.body?.printers !== undefined) {
//       st.printers = Array.isArray(req.body.printers) ? req.body.printers.map(String) : [];
//     }

//     st.updatedAt = now;

//     branch.stations = list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
//     await branch.save();

//     try {
//       await touchBranchMenuStampByBizId(branchId);
//     } catch (e) {
//       console.warn("[Stations][PUT] touch stamp failed:", e?.message);
//     }

//     return res.json({ ok: true, station: st, stations: branch.stations });
//   } catch (e) {
//     console.error("[Stations][PUT] error:", e);
//     return res.status(500).json({ error: "Internal server error" });
//   }
// };

// /**
//  * DELETE /api/vendor/branches/:branchId/stations/:key
//  */
// export const deleteStation = async (req, res) => {
//   try {
//     const branchId = asStr(req.params.branchId).trim();
//     const key = normalizeKey(req.params.key);
//     if (!branchId || !key) return res.status(400).json({ error: "branchId and key are required" });

//     const ok = await assertUserOwnsBranch(req, branchId);
//     if (!ok) return res.status(403).json({ error: "Forbidden" });

//     if (key === "MAIN") return res.status(409).json({ error: "MAIN cannot be deleted" });

//     const branch = await Branch.findOne({ branchId }).select("stations");
//     if (!branch) return res.status(404).json({ error: "Branch not found" });

//     const before = (branch.stations || []).length;
//     branch.stations = (branch.stations || []).filter((s) => normalizeKey(s.key) !== key);

//     if (branch.stations.length === before) {
//       return res.status(404).json({ error: "Station not found", key });
//     }

//     await branch.save();

//     try {
//       await touchBranchMenuStampByBizId(branchId);
//     } catch (e) {
//       console.warn("[Stations][DELETE] touch stamp failed:", e?.message);
//     }

//     return res.json({ ok: true, stations: branch.stations });
//   } catch (e) {
//     console.error("[Stations][DELETE] error:", e);
//     return res.status(500).json({ error: "Internal server error" });
//   }
// };

// /**
//  * PUT /api/vendor/branches/:branchId/stations/reorder
//  * Body: { order: ["MAIN", "DINE_IN", "BAR"] }
//  */
// export const reorderStations = async (req, res) => {
//   try {
//     const branchId = asStr(req.params.branchId).trim();
//     const order = req.body?.order;

//     if (!branchId) return res.status(400).json({ error: "branchId required" });
//     if (!Array.isArray(order) || order.length === 0) {
//       return res.status(400).json({ error: "order array is required" });
//     }

//     const ok = await assertUserOwnsBranch(req, branchId);
//     if (!ok) return res.status(403).json({ error: "Forbidden" });

//     const branch = await Branch.findOne({ branchId }).select("stations");
//     if (!branch) return res.status(404).json({ error: "Branch not found" });

//     const list = Array.isArray(branch.stations) ? branch.stations : [];
//     const map = new Map(list.map((s) => [normalizeKey(s.key), s]));

//     const now = new Date();
//     for (let i = 0; i < order.length; i++) {
//       const key = normalizeKey(order[i]);
//       const st = map.get(key);
//       if (st) {
//         st.sortOrder = i;
//         st.updatedAt = now;
//       }
//     }

//     const included = new Set(order.map((x) => normalizeKey(x)));
//     const rest = list.filter((s) => !included.has(normalizeKey(s.key)));
//     rest.forEach((s, idx) => {
//       s.sortOrder = order.length + idx;
//       s.updatedAt = now;
//     });

//     branch.stations = [...list].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
//     await branch.save();

//     try {
//       await touchBranchMenuStampByBizId(branchId);
//     } catch (e) {
//       console.warn("[Stations][REORDER] touch stamp failed:", e?.message);
//     }

//     return res.json({ ok: true, stations: branch.stations });
//   } catch (e) {
//     console.error("[Stations][REORDER] error:", e);
//     return res.status(500).json({ error: "Internal server error" });
//   }
// };
