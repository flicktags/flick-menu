// src/controllers/helpController.js
import Branch from "../models/Branch.js";
import HelpRequest from "../models/HelpRequest.js";
import Qr from "../models/QrCodeOrders.js"; // same model you use in kdsController

function safeStr(v, max = 300) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

// try to capture ip even behind proxies (if you use one)
function getClientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (xf) return String(xf).split(",")[0].trim();
  return req.ip || req.connection?.remoteAddress || null;
}

/**
 * PUBLIC: POST /api/public/help/call-waiter
 * Body:
 * {
 *   "branch": "BR-000004",
 *   "qr": { "qrId":"...", "label":"Table 5", "type":"table", "number":"table-5" },
 *   "message": "optional"
 * }
 */
export const callWaiter = async (req, res) => {
  try {
    const body = req.body || {};
    const branchId = safeStr(body.branch || body.branchId, 50);
    const qr = body.qr || null;
    const message = safeStr(body.message, 300);

    if (!branchId) return res.status(400).json({ error: "Missing branch" });
    if (!qr || typeof qr !== "object") {
      return res.status(400).json({ error: "Missing qr object" });
    }

    const branch = await Branch.findOne({ branchId }).lean();
    if (!branch) return res.status(404).json({ error: "Branch not found" });

    const vendorId = branch.vendorId;
    if (!vendorId) return res.status(400).json({ error: "Branch missing vendorId" });

    // 1) Validate / enrich QR
    let qrId = safeStr(qr.qrId, 80);
    let label = safeStr(qr.label, 80);
    let type = safeStr(qr.type, 20);
    let number = safeStr(qr.number, 80);

    if (qrId) {
      const qrDoc = await Qr.findOne({ qrId: String(qrId) }).lean();
      if (!qrDoc) {
        return res.status(400).json({ error: "Invalid qrId" });
      }

      // optional hard-guard if your Qr doc contains branchId/vendorId
      if (qrDoc.branchId && String(qrDoc.branchId) !== String(branchId)) {
        return res.status(403).json({ error: "QR does not belong to branch" });
      }
      if (qrDoc.vendorId && String(qrDoc.vendorId) !== String(vendorId)) {
        return res.status(403).json({ error: "QR does not belong to vendor" });
      }

      label = label ?? safeStr(qrDoc.label, 80);
      type = type ?? safeStr(qrDoc.type, 20);
      number = number ?? safeStr(qrDoc.number, 80);
    }

    // minimal required for KDS display
    if (!label && !number) {
      return res.status(400).json({ error: "QR missing label/number" });
    }

    // 2) Anti-spam: if OPEN request exists for same table within last 60 sec, just "ping"
    const now = new Date();
    const pingCutoff = new Date(now.getTime() - 60 * 1000);

    const existing = await HelpRequest.findOne({
      branchId,
      status: "OPEN",
      $or: [
        // prefer qrId match if available
        ...(qrId ? [{ "qr.qrId": qrId }] : []),
        // fallback match by label/number if no qrId
        ...(qrId ? [] : [{ "qr.label": label }, { "qr.number": number }]),
      ],
      lastPingAt: { $gte: pingCutoff },
    });

    if (existing) {
      existing.pingCount = (Number(existing.pingCount || 1) || 1) + 1;
      existing.lastPingAt = now;
      if (message) existing.message = message; // last message wins
      await existing.save();

      return res.status(200).json({
        ok: true,
        message: "Help request pinged",
        help: {
          id: String(existing._id),
          status: existing.status,
          pingCount: existing.pingCount,
          lastPingAt: existing.lastPingAt,
          qr: existing.qr,
        },
      });
    }

    // 3) Create new help request
    const created = await HelpRequest.create({
      vendorId,
      branchId,
      qr: { qrId: qrId ?? null, label: label ?? null, type: type ?? null, number: number ?? null },
      message: message ?? null,
      status: "OPEN",
      pingCount: 1,
      lastPingAt: now,
      clientIp: getClientIp(req),
      userAgent: safeStr(req.headers["user-agent"], 200),
    });

    return res.status(201).json({
      ok: true,
      message: "Waiter called",
      help: {
        id: String(created._id),
        status: created.status,
        createdAt: created.createdAt,
        lastPingAt: created.lastPingAt,
        pingCount: created.pingCount,
        qr: created.qr,
        message: created.message ?? null,
      },
    });
  } catch (err) {
    console.error("callWaiter error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};
