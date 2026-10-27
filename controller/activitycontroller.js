const ActivityLog = require("../models/ActivityLogmodel");
const AppError = require("../helpers/AppError");
const asyncHandler = require("../helpers/asyncHandler");
const paginate = require("../helpers/pagination");
const { contains } = require("../helpers/regex");
const { getDateFilter } = require("../helpers/reportDateFilter");

const POPULATE = { path: "userId", select: "name email role ProfilePic" };

/** Audit trail (read-only on purpose: logs can no longer be forged or deleted through the API). */
module.exports.getAllActivityLogs = asyncHandler(async (req, res) => {
  const { page, limit, entity, userId, query } = req.query;
  const filter = { ...getDateFilter(req.query) };
  if (entity && ActivityLog.ENTITIES.includes(entity)) filter.entity = entity;
  if (userId) filter.userId = userId;
  if (query) filter.$or = [{ action: contains(query) }, { description: contains(query) }];
  const result = await paginate({ model: ActivityLog, page, limit: limit || 20, query: filter, populate: POPULATE });
  res.status(200).json({ success: true, logs: result.data, pagination: result.pagination });
});

module.exports.getRecentActivitys = asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 5, 20);
  const logs = await ActivityLog.find().sort({ createdAt: -1 }).limit(limit).populate(POPULATE).lean();
  res.status(200).json(logs);
});

module.exports.getUserLogs = asyncHandler(async (req, res) => {
  const { userid } = req.params;
  if (req.user.role === "staff" && String(req.user._id) !== String(userid)) {
    throw new AppError(403, "You can only view your own activity.");
  }
  const logs = await ActivityLog.find({ userId: userid }).sort({ createdAt: -1 }).limit(Math.min(parseInt(req.query.limit, 10) || 20, 100)).lean();
  res.status(200).json(logs);
});
