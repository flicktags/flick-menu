// src/models/HelpRequest.js
import mongoose from "mongoose";

const HelpRequestSchema = new mongoose.Schema(
  {
    vendorId: { type: String, required: true, index: true },
    branchId: { type: String, required: true, index: true },

    qr: {
      qrId: { type: String, default: null, index: true },
      label: { type: String, default: null },
      type: { type: String, default: null },   // "table" | "room"
      number: { type: String, default: null }, // "table-5" etc
    },

    message: { type: String, default: null },

    status: { type: String, default: "OPEN", index: true }, // OPEN | ACKED | EXPIRED

    // for anti-spam / repeated taps
    pingCount: { type: Number, default: 1 },
    lastPingAt: { type: Date, default: Date.now, index: true },

    // ack info (KDS)
    ackAt: { type: Date, default: null, index: true },
    ackBy: { type: String, default: null }, // optional (firebase uid/email)

    // debug/audit (optional)
    clientIp: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  { timestamps: true }
);

// Common indexes
HelpRequestSchema.index({ branchId: 1, status: 1, createdAt: -1 });
HelpRequestSchema.index({ branchId: 1, "qr.qrId": 1, status: 1, lastPingAt: -1 });

// Optional auto-cleanup (keeps DB clean). 48 hours.
HelpRequestSchema.index({ createdAt: 1 }, { expireAfterSeconds: 48 * 3600 });

export default mongoose.model("HelpRequest", HelpRequestSchema);

