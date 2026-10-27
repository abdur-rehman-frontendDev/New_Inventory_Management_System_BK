const AppError = require("../helpers/AppError");
const { isProd } = require("../config/env");

const notFound = (req, res, next) => next(new AppError(404, `Route not found: ${req.method} ${req.originalUrl}`));

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  let status = err.status || err.statusCode || 500;
  let message = err.message || "Internal server error";
  let details = err.details;

  if (err.name === "ValidationError" && err.errors) {
    status = 400;
    details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
    message = details[0]?.message || "Validation failed";
  } else if (err.name === "CastError") {
    status = 400;
    message = `Invalid ${err.path || "value"}.`;
  } else if (err.code === 11000) {
    status = 409;
    const field = Object.keys(err.keyPattern || err.keyValue || {})[0];
    message = field ? `A record with this ${field} already exists.` : "Duplicate record.";
  } else if (err.name === "MulterError") {
    status = 400;
    message = err.code === "LIMIT_FILE_SIZE" ? "File is too large (max 10 MB)." : err.message;
  } else if (err.type === "entity.too.large") {
    status = 413;
    message = "Request body is too large.";
  } else if (err.type === "entity.parse.failed") {
    status = 400;
    message = "Malformed JSON body.";
  }

  if (status >= 500) {
    console.error(`[${req.method} ${req.originalUrl}]`, err);
    if (isProd) message = "Something went wrong on our side. Please try again.";
  }

  res.status(status).json({
    success: false,
    message,
    error: message, // kept for clients that still read `error`
    ...(details ? { errors: details } : {}),
  });
};

module.exports = { notFound, errorHandler };
