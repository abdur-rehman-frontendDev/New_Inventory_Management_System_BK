/** Escape user input before placing it inside a RegExp / $regex (prevents ReDoS + operator injection). */
const escapeRegex = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Case-insensitive "contains" matcher for Mongo queries. */
const contains = (value) => ({ $regex: escapeRegex(String(value).trim()), $options: "i" });

module.exports = { escapeRegex, contains };
