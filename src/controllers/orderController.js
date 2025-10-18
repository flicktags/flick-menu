// src/controllers/orderController.js
import Branch from "../models/Branch.js";
import MenuItem from "../models/MenuItem.js";
import Order from "../models/Order.js";
import Counter, { nextSeq } from "../models/Counter.js";

/**
 * Helper: how many decimals to round money values
 * BHD uses 3 decimals; most others use 2.
 */
function decimalsForCurrency(cur) {
  if (!cur) return 2;
  const c = String(cur).toUpperCase();
  return c === "BHD" ? 3 : 2;
}
function roundMoney(n, dp) {
  const p = Math.pow(10, dp);
  return Math.round((Number(n) + Number.EPSILON) * p) / p;
}

/**
 * Normalize/resolve a single request line item with DB values.
 * Returns { ok, err?, normalizedLine }
 */
async function resolveLineItem(reqLine, branchId, currency, dp) {
  try {
    const qty = Math.max(1, parseInt(reqLine?.quantity ?? 1, 10));

    // Fetch item from DB (if exists). We do not require vendor token; public read.
    const dbItem = await MenuItem.findOne({
      _id: reqLine?.itemId,
      branchId: branchId,
      isActive: true,
      isAvailable: true,
    }).lean();

    // Basic visible fields (fallback to request if DB is missing)
    const nameEnglish = dbItem?.nameEnglish ?? String(reqLine?.nameEnglish ?? "");
    const nameArabic  = dbItem?.nameArabic ?? String(reqLine?.nameArabic ?? "");
    const imageUrl    = dbItem?.imageUrl ?? String(reqLine?.imageUrl ?? "");

    // Determine size/base pricing
    const isSizedBased = Boolean(dbItem?.isSizedBased ?? reqLine?.isSizedBased);

    let size = null;
    let unitBasePrice = 0;

    if (isSizedBased) {
      const reqLabel = String(reqLine?.size?.label ?? "").trim();
      // try to match requested size against DB sizes
      const dbSizes = Array.isArray(dbItem?.sizes) ? dbItem.sizes : [];
      const hit = dbSizes.find(
        (s) => String(s?.label ?? "").trim().toLowerCase() === reqLabel.toLowerCase()
      );
      if (!hit) {
        // if no exact match, fallback to first size if exists
        if (dbSizes.length > 0) {
          size = { label: String(dbSizes[0].label ?? ""), price: Number(dbSizes[0].price ?? 0) };
        } else {
          // no sizes in DB → treat as 0 price
          size = { label: reqLabel || "Default", price: 0 };
        }
      } else {
        size = { label: String(hit.label ?? ""), price: Number(hit.price ?? 0) };
      }
      unitBasePrice = Number(size.price || 0);
    } else {
      // non-sized: prefer offeredPrice then fixedPrice from DB
      const base =
        dbItem?.offeredPrice ??
        dbItem?.fixedPrice ??
        reqLine?.offeredPrice ??
        reqLine?.fixedPrice ??
        0;
      unitBasePrice = Number(base || 0);
    }

    // Addons (optional). If your DB has structured addons, you can validate here.
    // For now, accept request addons but ignore any price they sent if you want strict control.
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
        size, // null for non-sized; {label, price} for sized
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
 * Body shape (from your UI):
 * {
 *   branch: "BR-000004",
 *   qr: { type: "room", number: "room-1", qrId: "QR-000131" },
 *   currency: "BHD",
 *   customer: { name: "Shabir", phone: null },
 *   items: [ ... ],
 *   remarks: "optional text",
 *   source: "customer_view"
 * }
 */
export const createOrder = async (req, res) => {
  try {
    const branchId = String(req.body?.branch || req.body?.branchId || "").trim();
    if (!branchId) {
      return res.status(400).json({ error: 'Missing "branch" (e.g., "BR-000004")' });
    }

    // Branch (business id)
    const branch = await Branch.findOne({ branchId }).lean();
    if (!branch) {
      return res.status(404).json({ error: "Branch not found" });
    }

    // Currency + taxes from branch; request currency can override display currency but rounding still by currency
    const currency = String(req.body?.currency || branch.currency || "").trim().toUpperCase();
    const dp = decimalsForCurrency(currency);

    const vatPercent = Number(branch?.taxes?.vatPercentage ?? 0);
    const serviceChargePercent = Number(branch?.taxes?.serviceChargePercentage ?? 0);

    // Lines
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

    // Pricing
    const subtotal = roundMoney(
      resolved.reduce((acc, l) => acc + Number(l.lineTotal || 0), 0),
      dp
    );
    const serviceChargeAmount = roundMoney((subtotal * serviceChargePercent) / 100, dp);
    const vatBase = subtotal + serviceChargeAmount;
    const vatAmount = roundMoney((vatBase * vatPercent) / 100, dp);
    const grandTotal = roundMoney(subtotal + serviceChargeAmount + vatAmount, dp);

    // Order number via Counter (string key)
    const counterKey = `ORD-${branchId}`; // e.g., "ORD-BR-000004"
    const seq = await nextSeq(counterKey); // 1,2,3,...
    const orderNumber = `${counterKey}-${String(seq).padStart(6, "0")}`;

    // Build order doc
    const qr = req.body?.qr && typeof req.body.qr === "object" ? req.body.qr : null;
    const customer = req.body?.customer && typeof req.body.customer === "object"
      ? req.body.customer
      : null;

    const payload = {
      orderNumber,                 // "ORD-BR-000004-000001"
      branchId,                    // business id
      currency,
      qr: qr
        ? {
            type: String(qr.type ?? ""),   // "room" | "table" (or TitleCase if you prefer)
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

    // Save
    const doc = await Order.create(payload);

    // Respond
    return res.status(201).json({
      message: "Order placed",
      orderId: doc._id,
      orderNumber: doc.orderNumber,
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
