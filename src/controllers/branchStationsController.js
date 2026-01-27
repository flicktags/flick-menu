// src/controllers/branchStationsController.js
import crypto from "crypto";
import Branch from "../models/Branch.js";
import { assertUserOwnsBranch } from "../utils/branchOwnership.js";
import { touchBranchMenuStampByBizId } from "../utils/touchMenuStamp.js"; // same helper you use

const asStr = (v, def = "") => (v == null ? def : String(v));
const asInt = (v, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
};

function makeStationId() {
  // ST- + 6 chars
  const rand = crypto.randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
  return `ST-${rand}`;
}

function normalizeKey(key) {
  return asStr(key).trim().toUpperCase().replace(/\s+/g, "_");
}

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
      stations: branch.stations || [],
    });
  } catch (e) {
    console.error("[Stations][GET] error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * POST /api/vendor/branches/:branchId/stations
 * Body: { key, nameEnglish, nameArabic?, sortOrder?, isEnabled? }
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

    if (!key) return res.status(400).json({ error: "key is required" });
    if (!nameEnglish) return res.status(400).json({ error: "nameEnglish is required" });
    if (key === "MAIN") return res.status(409).json({ error: "MAIN is reserved" });

    const branch = await Branch.findOne({ branchId }).select("stations vendorId branchId");
    if (!branch) return res.status(404).json({ error: "Branch not found" });

    branch.stations = Array.isArray(branch.stations) ? branch.stations : [];

    const exists = branch.stations.some((s) => normalizeKey(s.key) === key);
    if (exists) return res.status(409).json({ error: "Station key already exists", key });

    // Generate unique stationId inside branch
    let stationId = makeStationId();
    const ids = new Set(branch.stations.map((s) => String(s.stationId || "")));
    let attempts = 0;
    while (ids.has(stationId) && attempts < 5) {
      stationId = makeStationId();
      attempts++;
    }
    if (ids.has(stationId)) {
      return res.status(500).json({ error: "Could not generate unique stationId" });
    }

    const now = new Date();
    const station = {
      stationId,
      key,
      nameEnglish,
      nameArabic,
      isEnabled: req.body?.isEnabled === undefined ? true : isEnabled,
      sortOrder,
      printers: Array.isArray(req.body?.printers) ? req.body.printers.map(String) : [],
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

    return res.json({ ok: true, station, stations: branch.stations });
  } catch (e) {
    console.error("[Stations][POST] error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * PUT /api/vendor/branches/:branchId/stations/:key
 * Body: { nameEnglish?, nameArabic?, sortOrder?, isEnabled?, printers? }
 */
export const updateStation = async (req, res) => {
  try {
    const branchId = asStr(req.params.branchId).trim();
    const key = normalizeKey(req.params.key);
    if (!branchId || !key) return res.status(400).json({ error: "branchId and key are required" });

    const ok = await assertUserOwnsBranch(req, branchId);
    if (!ok) return res.status(403).json({ error: "Forbidden" });

    if (key === "MAIN") return res.status(409).json({ error: "MAIN cannot be modified here" });

    const branch = await Branch.findOne({ branchId }).select("stations");
    if (!branch) return res.status(404).json({ error: "Branch not found" });

    const list = Array.isArray(branch.stations) ? branch.stations : [];
    const idx = list.findIndex((s) => normalizeKey(s.key) === key);
    if (idx === -1) return res.status(404).json({ error: "Station not found", key });

    const st = list[idx];
    const now = new Date();

    if (req.body?.nameEnglish !== undefined) {
      const v = asStr(req.body.nameEnglish).trim();
      if (!v) return res.status(400).json({ error: "nameEnglish cannot be empty" });
      st.nameEnglish = v;
    }
    if (req.body?.nameArabic !== undefined) st.nameArabic = asStr(req.body.nameArabic).trim();
    if (req.body?.sortOrder !== undefined) st.sortOrder = asInt(req.body.sortOrder, st.sortOrder ?? 0);
    if (req.body?.isEnabled !== undefined) {
      st.isEnabled =
        typeof req.body.isEnabled === "boolean"
          ? req.body.isEnabled
          : asStr(req.body.isEnabled).toLowerCase() === "true";
    }
    if (req.body?.printers !== undefined) {
      st.printers = Array.isArray(req.body.printers) ? req.body.printers.map(String) : [];
    }

    st.updatedAt = now;

    branch.stations = list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    await branch.save();

    try {
      await touchBranchMenuStampByBizId(branchId);
    } catch (e) {
      console.warn("[Stations][PUT] touch stamp failed:", e?.message);
    }

    return res.json({ ok: true, station: st, stations: branch.stations });
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
    if (!branchId || !key) return res.status(400).json({ error: "branchId and key are required" });

    const ok = await assertUserOwnsBranch(req, branchId);
    if (!ok) return res.status(403).json({ error: "Forbidden" });

    if (key === "MAIN") return res.status(409).json({ error: "MAIN cannot be deleted" });

    const branch = await Branch.findOne({ branchId }).select("stations");
    if (!branch) return res.status(404).json({ error: "Branch not found" });

    const before = (branch.stations || []).length;
    branch.stations = (branch.stations || []).filter((s) => normalizeKey(s.key) !== key);

    if (branch.stations.length === before) {
      return res.status(404).json({ error: "Station not found", key });
    }

    await branch.save();

    try {
      await touchBranchMenuStampByBizId(branchId);
    } catch (e) {
      console.warn("[Stations][DELETE] touch stamp failed:", e?.message);
    }

    return res.json({ ok: true, stations: branch.stations });
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
      const key = normalizeKey(order[i]);
      const st = map.get(key);
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

    return res.json({ ok: true, stations: branch.stations });
  } catch (e) {
    console.error("[Stations][REORDER] error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
};
