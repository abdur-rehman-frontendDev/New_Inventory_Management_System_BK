const Order = require("../models/Ordermodel");
const AppError = require("../helpers/AppError");
const asyncHandler = require("../helpers/asyncHandler");
const { contains } = require("../helpers/regex");
const { reserveStock, restoreStock } = require("../services/stockService");
const { round2 } = require("../helpers/money");
const logActivity = require("../libs/logger");

const POPULATE = [
  { path: "Product.product", select: "name sku sellingPrice unit" },
  { path: "user", select: "name email" },
];

const log = (req, action, description, order) =>
  logActivity({ action, description, entity: "order", entityId: order._id, userId: req.user._id, ipAddress: req.ip });

const createOrder = asyncHandler(async (req, res) => {
  const { Description, Product, status } = req.body;
  const line = { product: Product.product, quantity: Product.quantity, name: "Product" };

  await reserveStock([line]);
  let order;
  try {
    order = await Order.create({
      user: req.user._id, // taken from the session, never from the body
      Description,
      Product,
      totalAmount: round2(Product.price * Product.quantity),
      status,
    });
  } catch (err) {
    await restoreStock([line]);
    throw err;
  }
  await log(req, "Create Order", `Order created: ${Description}`, order);
  res.status(201).json({ success: true, message: "Order created successfully", order });
});

const getOrder = asyncHandler(async (req, res) => {
  const orders = await Order.find({}).populate(POPULATE).sort({ createdAt: -1 }).limit(500).lean();
  res.status(200).json(orders); // empty list is a valid answer, not a 404
});

const searchOrder = asyncHandler(async (req, res) => {
  const q = (req.query.query || "").trim();
  if (!q) throw new AppError(400, "Query parameter is required");
  const orders = await Order.find({ $or: [{ Description: contains(q) }, { status: contains(q) }] })
    .populate(POPULATE).sort({ createdAt: -1 }).limit(200).lean();
  res.json(orders);
});

const updatestatusOrder = asyncHandler(async (req, res) => {
  const order = await Order.findByIdAndUpdate(req.params.OrderId, { status: req.body.status }, { new: true, runValidators: true });
  if (!order) throw new AppError(404, "Order not found");
  await log(req, "Update Order", `Order status set to ${order.status}.`, order);
  res.status(200).json({ message: "Order successfully updated", order });
});

/** Deleting an order that was not delivered returns its stock to the shelf. */
const Removeorder = asyncHandler(async (req, res) => {
  const order = await Order.findByIdAndDelete(req.params.OrderId);
  if (!order) throw new AppError(404, "Order is not found!");
  if (order.status !== "delivered") {
    await restoreStock([{ product: order.Product.product, quantity: order.Product.quantity }]);
  }
  await log(req, "Delete Order", "Order was deleted.", order);
  res.status(200).json({ message: "Order deleted successfully" });
});

const getOrderStatistics = asyncHandler(async (req, res) => {
  res.status(200).json(await Order.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]));
});

module.exports = { createOrder, searchOrder, updatestatusOrder, getOrder, Removeorder, getOrderStatistics };
