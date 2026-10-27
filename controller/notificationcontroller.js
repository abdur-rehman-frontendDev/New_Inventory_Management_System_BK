const Notification = require("../models/Notificationmodel");
const AppError = require("../helpers/AppError");
const asyncHandler = require("../helpers/asyncHandler");
const logActivity = require("../libs/logger");

const shape = (n, userId) => {
  const { readBy = [], ...rest } = n.toObject ? n.toObject() : n;
  return { ...rest, read: readBy.some((id) => String(id) === String(userId)) };
};

module.exports.createNotification = asyncHandler(async (req, res) => {
  const n = await Notification.create({ ...req.body, createdBy: req.user._id });
  await logActivity({ action: "Post Announcement", description: `Announcement "${n.name}" posted.`, entity: "notification", entityId: n._id, userId: req.user._id, ipAddress: req.ip });
  res.status(201).json({ success: true, message: "Notification created successfully.", notification: shape(n, req.user._id) });
});

module.exports.getAllNotifications = asyncHandler(async (req, res) => {
  const list = await Notification.find().sort({ createdAt: -1 }).limit(100).populate("createdBy", "name").lean();
  res.status(200).json(list.map((n) => shape(n, req.user._id)));
});

module.exports.getUnreadNotifications = asyncHandler(async (req, res) => {
  const list = await Notification.find({ readBy: { $ne: req.user._id } }).sort({ createdAt: -1 }).limit(100).lean();
  res.status(200).json({ success: true, unreadNotifications: list.map((n) => shape(n, req.user._id)) });
});

module.exports.markAsRead = asyncHandler(async (req, res) => {
  const n = await Notification.findByIdAndUpdate(req.params.id, { $addToSet: { readBy: req.user._id } }, { new: true });
  if (!n) throw new AppError(404, "Notification not found.");
  res.status(200).json({ success: true, message: "Notification marked as read.", notification: shape(n, req.user._id) });
});

module.exports.markAllAsRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ readBy: { $ne: req.user._id } }, { $addToSet: { readBy: req.user._id } });
  res.json({ success: true, message: "All notifications marked as read." });
});

module.exports.deleteNotification = asyncHandler(async (req, res) => {
  const n = await Notification.findByIdAndDelete(req.params.id);
  if (!n) throw new AppError(404, "Notification not found.");
  res.status(200).json({ success: true, message: "Notification deleted successfully." });
});
