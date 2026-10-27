const bcrypt = require("bcryptjs");
const User = require("../models/Usermodel");
const AppError = require("../helpers/AppError");
const asyncHandler = require("../helpers/asyncHandler");
const generateToken = require("../libs/Tokengenerator");
const cloudinary = require("../libs/Cloundinary");
const logActivity = require("../libs/logger");
const { cookieName, cookieOptions, allowPublicSignup } = require("../config/env");

// Compared against when the e-mail is unknown, so response time doesn't reveal which e-mails exist.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

const publicUser = (u, token) => ({
  id: u._id || u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  ProfilePic: u.ProfilePic || "",
  active: u.active !== false,
  createdAt: u.createdAt,
  ...(token ? { token } : {}),
});

const countAdmins = () => User.countDocuments({ role: "admin", active: { $ne: false } });

/** Tells the sign-up screen whether registration is open (and whether this will be the first/admin account). */
module.exports.signupStatus = asyncHandler(async (req, res) => {
  const bootstrap = (await User.estimatedDocumentCount()) === 0;
  res.json({ success: true, open: bootstrap || allowPublicSignup, bootstrap });
});

module.exports.signup = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;

  const isFirstUser = (await User.countDocuments()) === 0;
  if (!isFirstUser && !allowPublicSignup) {
    throw new AppError(403, "Registration is closed. Please ask an administrator to create your account.");
  }

  if (await User.findOne({ email })) throw new AppError(409, "An account with this email already exists.");

  // Role is NEVER taken from the request: first account = admin, everyone else = staff.
  const user = await User.create({
    name,
    email,
    password: await bcrypt.hash(password, 12),
    role: isFirstUser ? "admin" : "staff",
  });

  const token = await generateToken(user, res);
  await logActivity({
    action: "User Signup",
    description: `${isFirstUser ? "First administrator" : "User"} ${name} signed up.`,
    entity: "user",
    entityId: user._id,
    userId: user._id,
    ipAddress: req.ip,
  });

  res.status(201).json({ message: "Signup successful", savedUser: publicUser(user, token) });
});

module.exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });

  const ok = await bcrypt.compare(password, user ? user.password : DUMMY_HASH);
  if (!user || !ok) throw new AppError(401, "Invalid email or password.");
  if (user.active === false) throw new AppError(403, "This account has been deactivated.");

  const token = await generateToken(user, res);
  res.status(200).json({ message: "Logged in successfully", user: publicUser(user, token) });
});

module.exports.logout = asyncHandler(async (req, res) => {
  const { maxAge, ...opts } = cookieOptions;
  res.clearCookie(cookieName, opts);
  res.status(200).json({ message: "Logged out successfully" });
});

module.exports.me = asyncHandler(async (req, res) => {
  res.json({ success: true, user: publicUser(req.user) });
});

module.exports.updateProfile = asyncHandler(async (req, res) => {
  const { ProfilePic, name } = req.body;
  if (!ProfilePic && !name) throw new AppError(400, "Nothing to update.");

  const update = {};
  if (name) update.name = name;

  if (ProfilePic) {
    try {
      const uploaded = await cloudinary.uploader.upload(ProfilePic, {
        folder: "profile_inventory_system",
        transformation: [{ width: 400, height: 400, crop: "fill", gravity: "face" }],
      });
      update.ProfilePic = uploaded.secure_url;
    } catch (err) {
      console.error("Cloudinary upload failed:", err.message);
      throw new AppError(502, "Image upload failed. Please try again.");
    }
  }

  const updatedUser = await User.findByIdAndUpdate(req.user._id, update, { new: true }); // publicUser() strips the password
  res.status(200).json({ message: "Profile updated successfully", updatedUser: publicUser(updatedUser) });
});

module.exports.changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user._id);
  if (!(await bcrypt.compare(currentPassword, user.password))) {
    throw new AppError(400, "Current password is incorrect.");
  }
  user.password = await bcrypt.hash(newPassword, 12);
  await user.save();
  await logActivity({
    action: "Change Password",
    description: `${user.name} changed their password.`,
    entity: "user",
    entityId: user._id,
    userId: user._id,
    ipAddress: req.ip,
  });
  res.json({ message: "Password updated successfully" });
});

// ───────────── User administration ─────────────

module.exports.listUsers = asyncHandler(async (req, res) => {
  const users = await User.find().select("-password").sort({ createdAt: -1 }).lean();
  res.json({ success: true, users: users.map((u) => publicUser(u)) });
});

const byRole = (role) =>
  asyncHandler(async (req, res) => {
    const users = await User.find({ role }).select("-password").lean();
    // Kept for backwards compatibility with the old per-role endpoints (always an array now).
    res.status(200).json(users.map((u) => publicUser(u)));
  });
module.exports.staffuser = byRole("staff");
module.exports.manageruser = byRole("manager");
module.exports.adminuser = byRole("admin");

module.exports.createUser = asyncHandler(async (req, res) => {
  const { name, email, password, role } = req.body;
  if (await User.findOne({ email })) throw new AppError(409, "An account with this email already exists.");
  const user = await User.create({ name, email, password: await bcrypt.hash(password, 12), role });
  await logActivity({
    action: "Create User",
    description: `${req.user.name} created ${role} account for ${name}.`,
    entity: "user",
    entityId: user._id,
    userId: req.user._id,
    ipAddress: req.ip,
  });
  res.status(201).json({ message: "User created", user: publicUser(user) });
});

module.exports.setRole = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;
  const target = await User.findById(id);
  if (!target) throw new AppError(404, "User not found.");
  if (String(target._id) === String(req.user._id)) throw new AppError(400, "You cannot change your own role.");
  if (target.role === "admin" && role !== "admin" && (await countAdmins()) <= 1) {
    throw new AppError(400, "At least one administrator must remain.");
  }
  target.role = role;
  await target.save();
  await logActivity({
    action: "Change Role",
    description: `${req.user.name} changed ${target.name}'s role to ${role}.`,
    entity: "user",
    entityId: target._id,
    userId: req.user._id,
    ipAddress: req.ip,
  });
  res.json({ message: "Role updated", user: publicUser(target) });
});

module.exports.setActive = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { active } = req.body;
  const target = await User.findById(id);
  if (!target) throw new AppError(404, "User not found.");
  if (String(target._id) === String(req.user._id)) throw new AppError(400, "You cannot deactivate your own account.");
  if (target.role === "admin" && !active && (await countAdmins()) <= 1) {
    throw new AppError(400, "At least one administrator must remain active.");
  }
  target.active = active;
  await target.save();
  await logActivity({
    action: active ? "Activate User" : "Deactivate User",
    description: `${req.user.name} ${active ? "activated" : "deactivated"} ${target.name}.`,
    entity: "user",
    entityId: target._id,
    userId: req.user._id,
    ipAddress: req.ip,
  });
  res.json({ message: active ? "User activated" : "User deactivated", user: publicUser(target) });
});

module.exports.removeuser = asyncHandler(async (req, res) => {
  const { UserId } = req.params;
  const target = await User.findById(UserId);
  if (!target) throw new AppError(404, "User not found.");
  if (String(target._id) === String(req.user._id)) throw new AppError(400, "You cannot delete your own account.");
  if (target.role === "admin" && (await countAdmins()) <= 1) throw new AppError(400, "At least one administrator must remain.");

  await target.deleteOne();
  await logActivity({
    action: "Delete User",
    description: `${req.user.name} deleted user ${target.name}.`,
    entity: "user",
    entityId: target._id,
    userId: req.user._id,
    ipAddress: req.ip,
  });
  res.status(200).json({ message: "User deleted successfully" });
});
