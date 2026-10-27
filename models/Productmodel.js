const mongoose = require("mongoose");

const ProductSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    sku: { type: String, unique: true, sparse: true, trim: true },
    barcode: { type: String, unique: true, sparse: true, trim: true },
    Description: { type: String, default: "", trim: true, maxlength: 1000 },
    Category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true, index: true },
    brand: { type: String, default: "", trim: true },
    unit: { type: String, default: "Piece", trim: true },
    purchasePrice: { type: Number, required: true, min: 0 },
    sellingPrice: { type: Number, required: true, min: 0 },
    Price: { type: Number, default: 0 }, // legacy mirror of sellingPrice
    quantity: { type: Number, default: 0, min: 0 },
    reorderLevel: { type: Number, default: 5, min: 0 },
    image: { type: String, default: "" },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier" },
    status: { type: String, enum: ["Active", "Inactive"], default: "Active" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

ProductSchema.index({ name: 1 });
ProductSchema.index({ createdAt: -1 });
ProductSchema.index({ status: 1, quantity: 1 });

// Keep the legacy `Price` field in sync with `sellingPrice`
ProductSchema.pre("save", function (next) {
  if (this.isModified("sellingPrice")) this.Price = this.sellingPrice;
  next();
});

module.exports = mongoose.model("Product", ProductSchema);
