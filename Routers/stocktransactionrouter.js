const express = require("express");
const router = express.Router();
const c = require("../controller/stocktransaction");
const { authmiddleware, authorize } = require("../middleware/Authmiddleware");
const validate = require("../middleware/validate");
const v = require("../validators/stock");

router.use(authmiddleware, authorize("admin", "manager"));

router.post("/createStockTransaction", validate(v.create), c.createStockTransaction);
router.get("/getallStockTransaction", c.getAllStockTransactions);
router.get("/searchstocks", c.searchStocks);
router.get("/product/:productId", c.getStockTransactionsByProduct);
router.get("/supplier/:supplierId", c.getStockTransactionsBySupplier);

module.exports = router;
