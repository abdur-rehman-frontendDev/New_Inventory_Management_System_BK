const express = require("express");
const router = express.Router();
const { authmiddleware, authorize } = require("../middleware/Authmiddleware");
const c = require("../controller/reportsController");

// Reports expose cost and profit → admin / manager only.
router.use(authmiddleware, authorize("admin", "manager"));

router.get("/summary", c.getSummaryReport);
router.get("/products", c.getProductReport);
router.get("/customers", c.getCustomerReport);
router.get("/profit", c.getProfitReport);

module.exports = router;
