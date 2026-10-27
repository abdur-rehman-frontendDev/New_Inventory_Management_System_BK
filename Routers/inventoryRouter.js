const express = require("express");
const router = express.Router();
const c = require("../controller/inventorycontroller");
const { authmiddleware, authorize } = require("../middleware/Authmiddleware");

router.use(authmiddleware, authorize("admin", "manager"));

router.post("/inventory", c.addOrUpdateInventory);
router.get("/inventory", c.getAllInventory);
router.get("/inventory/:productId", c.getInventoryByProduct);
router.delete("/inventory/:productId", c.deleteInventory);

module.exports = router;
