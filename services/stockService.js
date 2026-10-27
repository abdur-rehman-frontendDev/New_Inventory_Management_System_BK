const Product = require("../models/Productmodel");
const AppError = require("../helpers/AppError");

/**
 * Atomic stock helpers.
 *
 * Every decrement is a *conditional* update (`quantity >= qty`) executed by MongoDB itself, so two
 * cashiers can never sell the last unit twice – no read-modify-write race, and it works on
 * standalone MongoDB as well as replica sets (no multi-document transaction required).
 */

/** Give stock back (used for rollbacks, cancellations and Stock-in). */
const restoreStock = async (items) => {
  await Promise.all(items.map((i) => Product.updateOne({ _id: i.product }, { $inc: { quantity: i.quantity } })));
};

/**
 * Take stock for all items, or none: if any line fails, the lines already taken are put back.
 * items: [{ product, quantity, name }]
 */
const reserveStock = async (items) => {
  const taken = [];
  try {
    for (const item of items) {
      const updated = await Product.findOneAndUpdate(
        { _id: item.product, status: "Active", quantity: { $gte: item.quantity } },
        { $inc: { quantity: -item.quantity } },
        { new: true },
      );
      if (!updated) {
        const current = await Product.findById(item.product).select("name quantity status").lean();
        if (!current) throw new AppError(404, `${item.name || "A product"} no longer exists.`);
        if (current.status !== "Active") throw new AppError(409, `${current.name} is inactive and cannot be sold.`);
        throw new AppError(409, `${current.name} has only ${current.quantity} left in stock.`);
      }
      taken.push(item);
    }
  } catch (err) {
    if (taken.length) await restoreStock(taken).catch((e) => console.error("Stock rollback failed:", e));
    throw err;
  }
};

/** Stock-in / Stock-out for one product. Returns the updated product. */
const applyMovement = async ({ product, type, quantity }) => {
  if (type === "Stock-in") {
    const updated = await Product.findByIdAndUpdate(product, { $inc: { quantity } }, { new: true });
    if (!updated) throw new AppError(404, "Product not found.");
    return updated;
  }

  const updated = await Product.findOneAndUpdate(
    { _id: product, quantity: { $gte: quantity } },
    { $inc: { quantity: -quantity } },
    { new: true },
  );
  if (!updated) {
    const current = await Product.findById(product).select("name quantity").lean();
    if (!current) throw new AppError(404, "Product not found.");
    throw new AppError(409, `Cannot remove ${quantity}: only ${current.quantity} of ${current.name} in stock.`);
  }
  return updated;
};

module.exports = { reserveStock, restoreStock, applyMovement };
