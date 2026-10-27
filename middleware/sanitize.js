/**
 * Removes Mongo operator keys ("$gt", "$ne", …) and dotted keys from user input so that
 * `{ "email": { "$ne": null } }` can never reach a query (NoSQL operator injection).
 */
const clean = (value) => {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object" && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (key.startsWith("$") || key.includes(".")) continue;
      out[key] = clean(val);
    }
    return out;
  }
  return value;
};

module.exports = (req, res, next) => {
  if (req.body) req.body = clean(req.body);
  if (req.params) req.params = clean(req.params);
  if (req.query) {
    // Express 4 allows reassigning req.query; keep a cleaned copy.
    const cleaned = clean(req.query);
    Object.keys(req.query).forEach((k) => delete req.query[k]);
    Object.assign(req.query, cleaned);
  }
  next();
};
module.exports.clean = clean;
