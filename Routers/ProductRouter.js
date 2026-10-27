const express = require("express");
const router = express.Router();
const c = require("../controller/productController");
const bulk = require("../controller/bulkUploadController");
const { authmiddleware, authorize } = require("../middleware/Authmiddleware");
const upload = require("../middleware/upload");
const validate = require("../middleware/validate");
const v = require("../validators/product");

const manage = [authmiddleware, authorize("admin", "manager")];

// Read – any signed-in user (staff need products to run the POS)
router.get("/getproduct", authmiddleware, validate(v.listQuery, "query"), c.getProduct);
router.get("/searchproduct", authmiddleware, validate(v.listQuery, "query"), c.SearchProduct);
router.get("/options", authmiddleware, c.getOptions);
router.get("/lookup/:code", authmiddleware, c.lookup);
router.get("/getTopProductsByQuantity", authmiddleware, c.getTopProductsByQuantity);

// Write – admin / manager only
router.post("/addproduct", ...manage, validate(v.create), c.Addproduct);
router.put("/editproduct/:productId", ...manage, validate(v.update), c.EditProduct);
router.delete("/removeproduct/:productId", ...manage, c.RemoveProduct);
router.get("/template", ...manage, bulk.template);
router.post("/uploadproducts", ...manage, upload.single("file"), bulk.UploadProducts);

module.exports = router;
