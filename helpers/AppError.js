/** Operational error that is safe to show to the client. */
class AppError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.details = details;
  }
}

module.exports = AppError;
