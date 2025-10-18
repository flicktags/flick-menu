// controllers/orderController.js
import Branch from "../models/Branch.js";
import Order from "../models/Order.js";
import { generateOrderId } from "../utils/generateOrderId.js";

/**
 * POST /api/public/orders
 * Public endpoint used by the customer view.
 */
export const createOrder = async (req, res) => {
  try {
    const {
      branch: branchBusinessId,
      qr = {},
      currency: currencyFromClient,
      customer = {},
      items = [],
      remarks = null,
      source = "customer_view",
    } = req.body || {};

    // Basic validation
    if (!branchBusinessId || typeof branchBusinessId !== "string") {
      return res.status(400).json({ message: 'Field "branch" (business id) is required' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "At least one item is required" });
    }

    // Branch lookup
    const branch = await Branch.findOne({ branchId: branchBusinessId }).lean();
    if (!branch) {
      return res.status(404).json({ message: "Branch not found" });
    }

    // Taxes / currency from branch
    const currency = String(branch.currency || currencyFromClient || "BHD");
    const vatPercent = toNumber(branch.taxes?.vatPercentage, 0);
    const serviceChargePercent = toNumber(branch.taxes?.serviceChargePercentage, 0);

    // Normalize items & compute line totals
    const normalizedItems = [];
    for (const raw of items) {
      const isSizedBased = raw?.isSizedBased === true;

      const qty = toPosInt(raw?.quantity, 1);
      const sizeLabel = isSizedBased ? String(raw?.size?.label || "") : null;
      const sizePrice = isSizedBased ? toMoney(raw?.size?.price) : null;

      const baseUnitPrice = isSizedBased ? sizePrice : toMoney(raw?.unitBasePrice);
      const addons = Array.isArray(raw?.addons)
        ? raw.addons.map((a) => ({
            id: toStringSafe(a?.id),
            label: toStringSafe(a?.label),
            price: toMoney(a?.price),
          }))
        : [];

      const addonsUnitTotal = round2(addons.reduce((s, a) => s + toMoney(a.price), 0));
      const unitTotal = round2(baseUnitPrice + addonsUnitTotal);
      const lineTotal = round2(unitTotal * qty);

      normalizedItems.push({
        itemId: toStringSafe(raw?.itemId),
        nameEnglish: toStringSafe(raw?.nameEnglish),
        nameArabic: toStringSafe(raw?.nameArabic),
        imageUrl: toStringSafe(raw?.imageUrl),

        isSizedBased,
        size: isSizedBased ? { label: sizeLabel, price: sizePrice } : null,

        addons,                // per-unit addons
        unitBasePrice: baseUnitPrice,
        addonsUnitTotal,       // per-unit total addons price
        unitTotal,             // per-unit total (base + addons)

        quantity: qty,
        notes: toStringNullable(raw?.notes),

        lineTotal,             // unitTotal * qty
      });
    }

    // Totals
    const subtotal = round2(normalizedItems.reduce((s, i) => s + i.lineTotal, 0));
    const serviceChargeAmount = round2((subtotal * serviceChargePercent) / 100);
    const vatBase = round2(subtotal + serviceChargeAmount);
    const vatAmount = round2((vatBase * vatPercent) / 100);
    const grandTotal = round2(vatBase + vatAmount);

    // Persist
    const orderId = await generateOrderId(); // e.g., "ORD-000001"
    const doc = await Order.create({
      orderId,
      status: "pending",
      branchObjectId: String(branch._id),
      branchBusinessId: branch.branchId,
      vendorId: branch.vendorId,
      currency,
      qr: {
        type: toStringSafe(qr?.type),    // "table" | "room"
        number: toStringSafe(qr?.number),// "table-9"
        qrId: toStringSafe(qr?.qrId),
      },
      customer: {
        name: toStringNullable(customer?.name),
        phone: toStringNullable(customer?.phone),
      },
      items: normalizedItems,
      pricing: {
        subtotal,
        serviceChargePercent,
        serviceChargeAmount,
        vatPercent,
        vatAmount,
        grandTotal,
      },
      remarks: toStringNullable(remarks),
      source: toStringSafe(source || "customer_view"),
    });

    return res.status(201).json({
      message: "Order placed",
      order: {
        _id: doc._id,
        orderId: doc.orderId,
        status: doc.status,
        currency: doc.currency,
        branchBusinessId: doc.branchBusinessId,
        vendorId: doc.vendorId,
        qr: doc.qr,
        customer: doc.customer,
        items: doc.items,
        pricing: doc.pricing,
        remarks: doc.remarks,
        source: doc.source,
        createdAt: doc.createdAt,
      },
    });
  } catch (err) {
    console.error("Order Error:", err);
    return res.status(500).json({ message: err.message });
  }
};

// helpers
function toNumber(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function toPosInt(v, d = 1) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : d;
}
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
function toMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return round2(n);
}
function toStringSafe(v) {
  return (v ?? "").toString();
}
function toStringNullable(v) {
  const s = (v ?? "").toString().trim();
  return s.length ? s : null;
}
