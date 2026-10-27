const express = require("express");
const router = express.Router();
const c = require("../controller/categorycontroller");
const bulk = require("../controller/categoryBulkUploadController");
const { authmiddleware, authorize } = require("../middleware/Authmiddleware");
const upload = require("../middleware/upload");
const validate = require("../middleware/validate");
const v = require("../validators/category");

const manage = [authmiddleware, authorize("admin", "manager")];

// NOTE: /getcategory used to be public – it is now protected like everything else.
router.get("/getcategory", authmiddleware, c.getCategory);
router.get("/searchcategory", authmiddleware, c.Searchcategory);
router.get("/options", authmiddleware, c.getOptions);

router.post("/createcategory", ...manage, validate(v.create), c.createCategory);
router.put("/updateCategory/:CategoryId", ...manage, validate(v.update), c.updateCategory);
router.delete("/removecategory/:CategoryId", ...manage, c.RemoveCategory);
router.get("/template", ...manage, bulk.template);
router.post("/uploadcategories", ...manage, upload.single("file"), bulk.UploadCategories);

module.exports = router;
