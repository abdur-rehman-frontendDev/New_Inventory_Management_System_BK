const mongoose = require("mongoose");

const ENTITIES = ["product", "category", "order", "user", "system", "pos", "supplier", "stock", "notification", "sale"];

const ActivityLogSchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    description: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    entity: { type: String, required: true, enum: ENTITIES },
    entityId: { type: mongoose.Schema.Types.ObjectId },
    ipAddress: { type: String },
  },
  { timestamps: true },
);

ActivityLogSchema.index({ createdAt: -1 });
ActivityLogSchema.index({ userId: 1, createdAt: -1 });

const ActivityLog = mongoose.model("ActivityLog", ActivityLogSchema);
ActivityLog.ENTITIES = ENTITIES;
module.exports = ActivityLog;
