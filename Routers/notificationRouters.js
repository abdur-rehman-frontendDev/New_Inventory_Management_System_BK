const express = require("express");
const router = express.Router();
const c = require("../controller/notificationcontroller");
const { authmiddleware, authorize } = require("../middleware/Authmiddleware");
const validate = require("../middleware/validate");
const v = require("../validators/notification");

router.use(authmiddleware);

router.get("/allNotification", c.getAllNotifications);
router.get("/unreadNotification", c.getUnreadNotifications);
router.put("/readAll", c.markAllAsRead);
router.put("/:id/readNotification", c.markAsRead);
router.post("/createNotification", authorize("admin", "manager"), validate(v.create), c.createNotification);
router.delete("/deleteNotification/:id", authorize("admin", "manager"), c.deleteNotification);

module.exports = router;
