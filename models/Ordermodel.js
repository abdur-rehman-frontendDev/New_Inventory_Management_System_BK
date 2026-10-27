const mongoose = require("mongoose");

const OrderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    Description: { type: String, required: true, trim: true, maxlength: 500 },
    Product: {
      product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
      quantity: { type: Number, required: true, min: 0.001 },
      price: { type: Number, required: true, min: 0 },
    },
    totalAmount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ["pending", "shipped", "delivered"], default: "pending" },
    invoiceUrl: { type: String },
  },
  { timestamps: true },
);

OrderSchema.index({ createdAt: -1 });
OrderSchema.index({ status: 1 });

module.exports = mongoose.model("Order", OrderSchema);
