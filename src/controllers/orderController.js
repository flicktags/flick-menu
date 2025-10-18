// Order creation for public (no auth)
import Branch from "../models/Branch.js";
import Counter from "../models/Counter.js";
import mongoose from "mongoose";

/**
 * POST /api/public/orders
 * Body shape (from customer_view):
 * {
 *   branch: "BR-000004",
 *   qr: { type: "room", number: "room-1", qrId: "QR-000131" },
 *   currency: "BHD",
 *   customer: { name: "Shabir", phone: null },
 *   items: [...],
 *   pricing: {...},   // client-side calc (we will recompute/validate)
 *   remarks: "leave at the desk",
 *   source: "customer_view"
 * }
 */
export const createOrder = async (req, res) => {
  try {
    const body = req.body || {};
    const branchId = String(body.branch || "").trim();
    if (!branchId) return res.status(400).json({ error: "branch is required" });

    const branch = await Branch.findOne({ branchId }).lean();
    if (!branch) return res.status(404).json({ error: "Branch not found" });

    // --- Recompute pricing on server (basic validation) ---
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) return res.status(400).json({ error: "No items" });

    const svcPct = Number(branch?.taxes?.serviceChargePercentage ?? 0); // e.g. 5
    const vatPct = Number(branch?.taxes?.vatPercentage ?? 0);           // e.g. 10

    let subtotal = 0;
    const normalizedItems = items.map((it) => {
      const qty = Number(it.quantity ?? 1);
      const unitBase = Number(it.unitBasePrice ?? 0);
      const addonsTotal = (Array.isArray(it.addons) ? it.addons : [])
        .reduce((sum, a) => sum + Number(a?.price ?? 0), 0);

      const line = (unitBase + addonsTotal) * qty;
      subtotal += line;

      return {
        itemId: String(it.itemId || ""),
        nameEnglish: String(it.nameEnglish || ""),
        nameArabic: String(it.nameArabic || ""),
        imageUrl: String(it.imageUrl || ""),
        isSizedBased: it.isSizedBased === true,
        size: it.size
          ? {
              label: String(it.size.label || ""),
              price: Number(it.size.price ?? 0),
            }
          : null,
        addons: (Array.isArray(it.addons) ? it.addons : []).map((a) => ({
          id: String(a.id || a._id || a.label || ""),
          label: String(a.label || ""),
          price: Number(a.price ?? 0),
        })),
        unitBasePrice: unitBase,
        quantity: qty,
        notes: it.notes ? String(it.notes) : null,
        lineTotal: Number(line.toFixed(3)),
      };
    });

    const serviceChargeAmount = Number(((subtotal * svcPct) / 100).toFixed(3));
    const vatAmount = Number((((subtotal + serviceChargeAmount) * vatPct) / 100).toFixed(3));
    const grandTotal = Number((subtotal + serviceChargeAmount + vatAmount).toFixed(3));

    // --- Generate order number using a counter (NO 'key' field) ---
    const counterId = `ORD-${branchId}`;
    const counter = await Counter.findOneAndUpdate(
      { _id: counterId },            // <-- use _id, not 'key'
      { $inc: { seq: 1 } },
      { new: true, upsert: true }    // strict-safe
    ).lean();

    const seq = Number(counter?.seq ?? 1);
    const orderNumber = `${branchId}-${String(seq).padStart(6, "0")}`;

    // --- Persist order (minimal schema-less save for now) ---
    // If you DO have an Order model, use it here. For a lightweight start:
    const Order = mongoose.connection.collection("orders");

    const doc = {
      orderNumber,
      branchId,
      vendorId: branch.vendorId,
      qr: {
        type: String(body?.qr?.type || ""),
        number: String(body?.qr?.number || ""),
        qrId: String(body?.qr?.qrId || ""),
      },
      currency: String(body.currency || branch.currency || ""),
      customer: {
        name: body?.customer?.name ? String(body.customer.name) : null,
        phone: body?.customer?.phone ? String(body.customer.phone) : null,
      },
      items: normalizedItems,
      pricing: {
        subtotal: Number(subtotal.toFixed(3)),
        serviceChargePercent: svcPct,
        serviceChargeAmount,
        vatPercent: vatPct,
        vatAmount,
        grandTotal,
      },
      remarks: body.remarks ? String(body.remarks) : null,
      source: String(body.source || "customer_view"),
      status: "PLACED",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await Order.insertOne(doc);

    return res.status(201).json({
      message: "Order placed",
      orderNumber,
      branchId,
      pricing: doc.pricing,
      items: doc.items,
      qr: doc.qr,
      createdAt: doc.createdAt,
    });
  } catch (err) {
    console.error("Create Order Error:", err);
    return res.status(500).json({ error: err.message });
  }
};
