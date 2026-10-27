const mongoose = require("mongoose");

const SupplierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    contactInfo: {
      phone: { type: String, default: "", trim: true },
      email: { type: String, default: "", trim: true, lowercase: true },
      address: { type: String, default: "", trim: true },
    },
    // Was a single ObjectId; an array is a superset (Mongoose wraps legacy single values on read).
    productsSupplied: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
  },
  { timestamps: true },
);

SupplierSchema.index({ name: 1 });

module.exports = mongoose.model("Supplier", SupplierSchema);
