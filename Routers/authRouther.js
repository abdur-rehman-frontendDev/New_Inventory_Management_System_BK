const express = require("express");
const router = express.Router();
const c = require("../controller/authcontroller");
const { authmiddleware, authorize } = require("../middleware/Authmiddleware");
const validate = require("../middleware/validate");
const v = require("../validators/auth");
const { authLimiter } = require("../middleware/rateLimiters");

// Public
router.get("/signup-status", c.signupStatus);
router.post("/signup", authLimiter, validate(v.signup), c.signup);
router.post("/login", authLimiter, validate(v.login), c.login);

// Session
router.post("/logout", c.logout);
router.get("/me", authmiddleware, c.me);
router.put("/updateProfile", authmiddleware, validate(v.updateProfile), c.updateProfile);
router.put("/changePassword", authmiddleware, validate(v.changePassword), c.changePassword);

// Legacy per-role lists (now protected)
router.get("/staffuser", authmiddleware, authorize("admin", "manager"), c.staffuser);
router.get("/manageruser", authmiddleware, authorize("admin", "manager"), c.manageruser);
router.get("/adminuser", authmiddleware, authorize("admin", "manager"), c.adminuser);

// User administration
router.get("/users", authmiddleware, authorize("admin", "manager"), c.listUsers);
router.post("/users", authmiddleware, authorize("admin"), validate(v.createUser), c.createUser);
router.put("/users/:id/role", authmiddleware, authorize("admin"), validate(v.setRole), c.setRole);
router.put("/users/:id/active", authmiddleware, authorize("admin"), validate(v.setActive), c.setActive);
router.delete("/removeuser/:UserId", authmiddleware, authorize("admin"), c.removeuser);

module.exports = router;
