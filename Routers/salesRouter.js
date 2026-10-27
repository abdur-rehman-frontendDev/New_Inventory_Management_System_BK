const express = require("express");
const router = express.Router();
const c = require("../controller/salescontroller");
const { authmiddleware, authorize } = require("../middleware/Authmiddleware");

router.use(authmiddleware, authorize("admin", "manager"));

router.post("/createsales", c.createSale);
router.get("/getallsales", c.getAllSales);
router.get("/searchdata", c.SearchSales);
router.get("/:saleId", c.getSaleById);
router.put("/updatesales/:saleId", c.updateSale);

module.exports = router;
