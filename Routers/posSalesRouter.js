const express = require("express");
const router = express.Router();
const c = require("../controller/posSalesController");
const { authmiddleware, authorize } = require("../middleware/Authmiddleware");
const validate = require("../middleware/validate");
const v = require("../validators/pos");

// Everything here needs a signed-in user (previously this whole router was public!)
router.use(authmiddleware);

router.post("/create", validate(v.create), c.createPOSSale);
router.get("/", c.getAllPOSSales);
router.get("/all", c.getAllPOSSales);
router.get("/search", c.searchPOSSales);
router.get("/today", c.getTodaySales);
router.get("/recent", c.getRecentSales);
router.get("/:id", c.getPOSSaleById);
router.put("/cancel/:id", authorize("admin", "manager"), validate(v.cancel), c.cancelPOSSale);

module.exports = router;
