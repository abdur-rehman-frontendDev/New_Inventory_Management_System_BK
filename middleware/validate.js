const AppError = require("../helpers/AppError");

/**
 * Validates req[source] with a zod schema and replaces it with the parsed (trimmed / coerced /
 * stripped) value, so controllers only ever see clean data.
 */
module.exports =
  (schema, source = "body") =>
  (req, res, next) => {
    const result = schema.safeParse(req[source] ?? {});
    if (!result.success) {
      const errors = result.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      }));
      const first = errors[0];
      return next(new AppError(400, first ? `${first.field ? first.field + ": " : ""}${first.message}` : "Invalid input", errors));
    }
    req[source] = result.data;
    next();
  };
