const Counter = require("../models/CounterModel");

const getNextSequence = async (counterName, attempt = 0) => {
  try {
    const counter = await Counter.findOneAndUpdate(
      { name: counterName },
      { $inc: { sequence: 1 } },
      { new: true, upsert: true },
    );
    return counter.sequence;
  } catch (err) {
    if (err.code === 11000 && attempt < 3) return getNextSequence(counterName, attempt + 1);
    throw err;
  }
};

const generateSKU = async () => `SKU${String(await getNextSequence("PRODUCT_SKU")).padStart(6, "0")}`;
const generateBarcode = async () => `100${String(await getNextSequence("PRODUCT_BARCODE")).padStart(7, "0")}`;

module.exports = { generateSKU, generateBarcode };
