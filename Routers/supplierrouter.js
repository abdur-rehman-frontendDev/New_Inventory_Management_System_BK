const express = require("express");
const router = express.Router();
const c = require("../controller/suppliercontroller");
const { authmiddleware, authorize } = require("../middleware/Authmiddleware");
const validate = require("../middleware/validate");
const v = require("../validators/supplier");

router.use(authmiddleware, authorize("admin", "manager"));

router.post("/createsupplier", validate(v.create), c.createSupplier);
router.get("/getallsupplier", c.getAllSuppliers);
// Static routes MUST come before "/:supplierId" or they are swallowed by it (old bug).
router.get("/searchSupplier", c.searchSupplier);
router.get("/:supplierId", c.getSupplierById);
router.put("/updatesupplier/:supplierId", validate(v.update), c.editSupplier);
router.delete("/:supplierId", c.deleteSupplier);

module.exports = router;
