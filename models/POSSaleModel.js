const mongoose = require("mongoose");

const POSItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    name: { type: String, required: true },
    sku: { type: String, default: "" },
    barcode: { type: String, default: "" },
    unit: { type: String, default: "Piece" },
    quantity: { type: Number, required: true, min: 0.001 },
    purchasePrice: { type: Number, required: true, min: 0 },
    unitPrice: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const POSSaleSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true },
    customerName: { type: String, default: "Walk-in Customer", trim: true },
    customerPhone: { type: String, default: "", trim: true },
    items: {
      type: [POSItemSchema],
      validate: [(v) => Array.isArray(v) && v.length > 0, "A sale needs at least one item."],
    },
    subtotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    tax: { type: Number, default: 0, min: 0 },
    grandTotal: { type: Number, required: true, min: 0 },
    tenderedAmount: { type: Number }, // cash actually handed over (can exceed grandTotal)
    paidAmount: { type: Number, default: 0 }, // amount applied to this invoice (<= grandTotal)
    changeAmount: { type: Number, default: 0 },
    dueAmount: { type: Number, default: 0 },
    totalProfit: { type: Number, default: 0 },
    paymentMethod: { type: String, enum: ["Cash", "Card", "Bank", "JazzCash", "EasyPaisa"], default: "Cash" },
    paymentStatus: { type: String, enum: ["Paid", "Partial", "Pending", "Refunded"], default: "Paid" },
    status: { type: String, enum: ["Completed", "Cancelled", "Returned"], default: "Completed" },
    notes: { type: String, default: "" },
    cancelledAt: { type: Date },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    cancelReason: { type: String, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

POSSaleSchema.index({ createdAt: -1 });
POSSaleSchema.index({ status: 1, createdAt: -1 });
POSSaleSchema.index({ customerName: 1 });
POSSaleSchema.index({ customerPhone: 1 });
POSSaleSchema.index({ "items.product": 1 });

module.exports = mongoose.model("POSSale", POSSaleSchema);
