const ActivityLog = require("../models/ActivityLogmodel");

/** Writes an audit entry. Never throws – auditing must not break the business operation. */
const logActivity = async ({ action, description, entity = "system", entityId, userId, ipAddress }) => {
  try {
    await ActivityLog.create({
      action,
      description,
      entity,
      entityId: entityId || undefined,
      userId: userId || undefined,
      ipAddress,
    });
  } catch (error) {
    console.error("Error logging activity:", error.message);
  }
};

module.exports = logActivity;
