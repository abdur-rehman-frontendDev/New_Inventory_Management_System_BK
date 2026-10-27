const express = require("express");
const router = express.Router();
const c = require("../controller/orderController");
const { authmiddleware, authorize } = require("../middleware/Authmiddleware");
const validate = require("../middleware/validate");
const v = require("../validators/order");

router.use(authmiddleware, authorize("admin", "manager"));

router.post("/createorder", validate(v.create), c.createOrder);
router.get("/getorders", c.getOrder);
router.get("/Searchdata", c.searchOrder);
router.get("/graphstatusorder", c.getOrderStatistics);
router.put("/updatestatusOrder/:OrderId", validate(v.updateStatus), c.updatestatusOrder);
router.delete("/removeorder/:OrderId", c.Removeorder);

module.exports = router;
