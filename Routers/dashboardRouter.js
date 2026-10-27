const express = require("express");
const router = express.Router();
const { authmiddleware } = require("../middleware/Authmiddleware");
const c = require("../controller/dashboardController");

router.use(authmiddleware);
router.get("/summary", c.getDashboardSummary);
router.get("/trend", c.getDashboardTrend);
router.get("/recent-sales", c.getRecentDashboardSales);
router.get("/low-stock", c.getLowStockProducts);
router.get("/best-selling", c.getBestSellingProducts);

module.exports = router;
