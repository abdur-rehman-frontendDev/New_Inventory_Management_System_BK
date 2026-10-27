const cloudinary = require("cloudinary").v2;
const { cloudinary: cfg } = require("../config/env");

cloudinary.config(cfg);

module.exports = cloudinary;
