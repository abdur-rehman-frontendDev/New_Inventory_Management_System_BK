const multer = require("multer");
const path = require("path");
const AppError = require("../helpers/AppError");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (![".xlsx", ".xls", ".csv"].includes(ext)) {
      return cb(new AppError(400, "Only .xlsx, .xls and .csv files are allowed."));
    }
    cb(null, true);
  },
});

module.exports = upload;
