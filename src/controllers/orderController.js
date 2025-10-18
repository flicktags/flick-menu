// src/controllers/orderController.js
import Branch from "../models/Branch.js";
import MenuItem from "../models/MenuItem.js";
import Order from "../models/Order.js";
import Counter, { nextSeq } from "../models/Counter.js";

// ---- helpers ----
function decimalsForCurrency(cur) {
  if (!cur) return 2;
  const c = String(cur).toUpperCase();
  return c === "BHD" ? 3 : 2;
}
function roundMoney(n, dp) {
  const p = Math.pow(10, dp);
  return Math.round((Number(n) + Number.EPSILON) * p) / p;
}
function onlyDigits(s) {
  return String(s || "").replace(/\D+/g, "");
}
function lastN(str, n) {
  const d = onlyDigits(str);
  if (d.length >= n) return d.slice(-n);
  return d.padStart(n, "0");
}
function ymdInTZ(tz) {
  // Use Intl.DateTimeFormat to get parts in the branch timezone (fallback UTC)
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value || "0000";
  const m = parts.find((p) => p.type === "month")?.value || "00";
  const d = parts.find((p) => p.type === "day")?.value || "00";
  return { y, m, d };
}

/**
 * Normalize/resolve a single request line item with DB values.
 */
async function resolveLineItem(reqLine, branchId, currency, dp) {
  try {
    const qty = Math.max(1, parseInt(reqLine?.quantity ?? 1, 10));

    const dbItem = await MenuItem.findOne({
      _id: reqLine?.itemId,
      branchId: branchId,
      isActive: true,
      isAvailable: true,
    }).lean();

    const nameEnglish = dbItem?.nameEnglish ?? String(reqLine?.nameEnglish ?? "");
    const nameArabic  = dbItem?.nameArabic ?? String(reqLine?.nameArabic ?? "");
    const imageUrl    = dbItem?.imageUrl ?? String(reqLine?.imageUrl ?? "");

    const isSizedBased = Boolean(dbItem?.isSizedBased ?? reqLine?.isSizedBased);

    let size = null;
    let unitBasePrice = 0;

    if (isSizedBased) {
      const reqLabel = String(reqLine?.size?.label ?? "").trim();
      const dbSizes = Array.isArray(dbItem?.sizes) ? dbItem.sizes : [];
      const hit = dbSizes.find(
        (s) => String(s?.label ?? "").trim().toLowerCase() === reqLabel.toLowerCase()
      );
      if (!hit) {
        if (dbSizes.length > 0) {
          size = { label: String(dbSizes[0].label ?? ""), price: Number(dbSizes[0].price ?? 0) };
        } else {
          size = { label: reqLabel || "Default", price: 0 };
        }
      } else {
        size = { label: String(hit.label ?? ""), price: Number(hit.price ?? 0) };
      }
      unitBasePrice = Number(size.price || 0);
    } else {
      const base =
        dbItem?.offeredPrice ??
        dbItem?.fixedPrice ??
        reqLine?.offeredPrice ??
        reqLine?.fixedPrice ??
        0;
      unitBasePrice = Number(base || 0);
    }

    const reqAddons = Array.isArray(reqLine?.addons) ? reqLine.addons : [];
    const normalizedAddons = reqAddons.map((a) => ({
      id: (a?._id ?? a?.id ?? a?.label ?? "").toString(),
      label: (a?.label ?? a?.nameEnglish ?? a?.nameArabic ?? "").toString(),
      price: Number(a?.price ?? 0),
    }));
    const addonsSum = normalizedAddons.reduce((acc, a) => acc + Number(a.price || 0), 0);
    const unitTotal = unitBasePrice + addonsSum;
    const lineTotal = roundMoney(unitTotal * qty, dp);

    return {
      ok: true,
      normalizedLine: {
        itemId: dbItem?._id?.toString() ?? String(reqLine?.itemId ?? ""),
        nameEnglish,
        nameArabic,
        imageUrl,
        isSizedBased,
        size, // null if not sized
        addons: normalizedAddons,
        unitBasePrice: roundMoney(unitBasePrice, dp),
        quantity: qty,
        notes: String(reqLine?.notes ?? ""),
        lineTotal,
      },
    };
  } catch (err) {
    return { ok: false, err };
  }
}

/**
 * POST /api/public/orders
 */
export const createOrder = async (req, res) => {
  try {
    const branchId = String(req.body?.branch || req.body?.branchId || "").trim();
    if (!branchId) {
      return res.status(400).json({ error: 'Missing "branch" (e.g., "BR-000004")' });
    }

    const branch = await Branch.findOne({ branchId }).lean();
    if (!branch) return res.status(404).json({ error: "Branch not found" });

    const currency = String(req.body?.currency || branch.currency || "").trim().toUpperCase();
    const dp = decimalsForCurrency(currency);

    const vatPercent = Number(branch?.taxes?.vatPercentage ?? 0);
    const serviceChargePercent = Number(branch?.taxes?.serviceChargePercentage ?? 0);

    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    if (rawItems.length === 0) {
      return res.status(400).json({ error: "No items provided" });
    }

    const resolved = [];
    for (const line of rawItems) {
      const r = await resolveLineItem(line, branchId, currency, dp);
      if (!r.ok) {
        return res.status(400).json({
          error: "Unable to resolve item",
          itemId: line?.itemId ?? null,
          details: String(r.err?.message || r.err),
        });
      }
      resolved.push(r.normalizedLine);
    }

    const subtotal = roundMoney(
      resolved.reduce((acc, l) => acc + Number(l.lineTotal || 0), 0),
      dp
    );
    const serviceChargeAmount = roundMoney((subtotal * serviceChargePercent) / 100, dp);
    const vatBase = subtotal + serviceChargeAmount;
    const vatAmount = roundMoney((vatBase * vatPercent) / 100, dp);
    const grandTotal = roundMoney(subtotal + serviceChargeAmount + vatAmount, dp);

    // ---- ORDER NUMBER (YYYYMMDD + vendor2 + branch5 + counter7) ----
    const { y, m, d } = ymdInTZ(branch?.timeZone); // branch-local date
    const vendor2  = lastN(branch?.vendorId, 2);    // e.g. V000023 -> "23"
    const branch5  = lastN(branchId, 5);            // e.g. BR-000004 -> "00004"

    // Per-branch counter key remains stable for sequencing
    const counterKey = `ORD-${branchId}`;
    const seq = await nextSeq(counterKey);          // 1, 2, 3, ...
    const counter7 = String(seq).padStart(7, "0");

    const orderNumber = `${y}${m}${d}${vendor2}${branch5}${counter7}`;

    const qr = req.body?.qr && typeof req.body.qr === "object" ? req.body.qr : null;
    const customer = req.body?.customer && typeof req.body.customer === "object"
      ? req.body.customer
      : null;

    const payload = {
      orderNumber,                 // e.g., 2025101823000040000001
      branchId,
      currency,
      qr: qr
        ? {
            type: String(qr.type ?? ""),
            number: String(qr.number ?? ""),
            qrId: String(qr.qrId ?? ""),
          }
        : null,
      customer: {
        name: String(customer?.name ?? ""),
        phone: customer?.phone ? String(customer.phone) : null,
      },
      items: resolved,
      pricing: {
        subtotal,
        serviceChargePercent,
        serviceChargeAmount,
        vatPercent,
        vatAmount,
        grandTotal,
      },
      remarks: req.body?.remarks ? String(req.body.remarks) : null,
      source: String(req.body?.source ?? "customer_view"),
      status: "PENDING",
      placedAt: new Date(),
    };

    const doc = await Order.create(payload);

    return res.status(201).json({
      message: "Order placed",
      orderId: doc._id,
      orderNumber: doc.orderNumber, // now YYYYMMDD + vendor2 + branch5 + counter7
      branchId: doc.branchId,
      currency: doc.currency,
      status: doc.status,
      pricing: doc.pricing,
      items: doc.items,
      customer: doc.customer,
      qr: doc.qr,
      placedAt: doc.placedAt,
    });
  } catch (err) {
    console.error("[ORDER][CREATE][ERROR]", err);
    return res.status(500).json({ error: err.message || "Internal Server Error" });
  }
};
