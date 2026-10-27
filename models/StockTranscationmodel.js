const mongoose = require("mongoose");

const StockTranscationSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    type: { type: String, enum: ["Stock-in", "Stock-out"], required: true },
    quantity: { type: Number, required: true, min: 0.001 },
    balanceAfter: { type: Number },
    note: { type: String, default: "", trim: true, maxlength: 300 },
    transactionDate: { type: Date, default: Date.now },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

StockTranscationSchema.index({ transactionDate: -1 });
StockTranscationSchema.index({ product: 1, transactionDate: -1 });

module.exports = mongoose.model("StockTranscation", StockTranscationSchema);
