const express = require("express");
const router = express.Router();
const c = require("../controller/activitycontroller");
const { authmiddleware, authorize } = require("../middleware/Authmiddleware");

router.use(authmiddleware);

router.get("/getAllLogs", authorize("admin", "manager"), c.getAllActivityLogs);
router.get("/getrecentActivitys", authorize("admin", "manager"), c.getRecentActivitys);
router.get("/getLogs/:userid", c.getUserLogs);

module.exports = router;
