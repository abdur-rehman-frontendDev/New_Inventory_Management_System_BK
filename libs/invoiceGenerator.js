const Counter = require("../models/CounterModel");

/**
 * Sequential invoice numbers (INV-000001). Uses an atomic counter; the retry covers the one-time
 * race where two requests try to create the very first counter document simultaneously.
 */
async function generateInvoiceNumber(attempt = 0) {
  try {
    const counter = await Counter.findOneAndUpdate(
      { name: "invoice" },
      { $inc: { sequence: 1 } },
      { new: true, upsert: true },
    );
    return `INV-${String(counter.sequence).padStart(6, "0")}`;
  } catch (err) {
    if (err.code === 11000 && attempt < 3) return generateInvoiceNumber(attempt + 1);
    throw err;
  }
}

module.exports = generateInvoiceNumber;
