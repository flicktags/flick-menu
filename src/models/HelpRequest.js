// src/models/HelpRequest.js
import mongoose from "mongoose";

const HelpRequestSchema = new mongoose.Schema(
  {
    // ✅ IMPORTANT: your controller queries by vendorId + branchId
    vendorId: { type: String, required: true, index: true },

    // Branch CODE like "BR-000005"
    branchId: { type: String, required: true, index: true },

    qr: {
      type: { type: String, default: "" },   // "table" | "room"
      number: { type: String, default: "" }, // "table-1"
      label: { type: String, default: "" },  // "Table 1"
      qrId: { type: String, default: "" },
    },

    // ✅ stable key for "same table"
    // (qrid::<qrId>) OR (table::<number>) OR (label::<label>)
    qrKey: { type: String, required: true, index: true },

    status: {
      type: String,
      enum: ["OPEN", "ACK"],
      default: "OPEN",
      index: true,
    },

    message: { type: String, default: "" },

    pingCount: { type: Number, default: 1 },
    lastPingAt: { type: Date, default: Date.now },

    // Optional tracking fields (your controller already sets these)
    clientIp: { type: String, default: null },
    userAgent: { type: String, default: null },

    acknowledgedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// ✅ Only ONE OPEN request per same table within the same branch+vendor
// This prevents duplicates even if 2 calls hit at the same moment.
HelpRequestSchema.index(
  { vendorId: 1, branchId: 1, qrKey: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "OPEN" } }
);

export default mongoose.model("HelpRequest", HelpRequestSchema);


// import mongoose from "mongoose";

// const HelpRequestSchema = new mongoose.Schema(
//   {
//     vendorId: { type: String, required: true, index: true },
//     branchId: { type: String, required: true, index: true },

//     qr: {
//       qrId: { type: String, default: null, index: true },
//       label: { type: String, default: null },
//       type: { type: String, default: null },   // "table" | "room"
//       number: { type: String, default: null }, // "table-5" etc
//     },

//     message: { type: String, default: null },

//     status: { type: String, default: "OPEN", index: true }, // OPEN | ACKED | EXPIRED

//     // for anti-spam / repeated taps
//     pingCount: { type: Number, default: 1 },
//     lastPingAt: { type: Date, default: Date.now, index: true },

//     // ack info (KDS)
//     ackAt: { type: Date, default: null, index: true },
//     ackBy: { type: String, default: null }, // optional (firebase uid/email)

//     // debug/audit (optional)
//     clientIp: { type: String, default: null },
//     userAgent: { type: String, default: null },
//   },
//   { timestamps: true }
// );

// // Common indexes
// HelpRequestSchema.index({ branchId: 1, status: 1, createdAt: -1 });
// HelpRequestSchema.index({ branchId: 1, "qr.qrId": 1, status: 1, lastPingAt: -1 });

// // Optional auto-cleanup (keeps DB clean). 48 hours.
// HelpRequestSchema.index({ createdAt: 1 }, { expireAfterSeconds: 48 * 3600 });

// export default mongoose.model("HelpRequest", HelpRequestSchema);

