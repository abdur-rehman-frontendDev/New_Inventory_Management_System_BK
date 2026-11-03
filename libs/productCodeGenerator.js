const Counter = require("../models/CounterModel");

const getNextSequence = async (counterName, attempt = 0, step = 1) => {
  try {
    const counter = await Counter.findOneAndUpdate(
      { name: counterName },
      { $inc: { sequence: step } },
      { new: true, upsert: true },
    );
    return counter.sequence;
  } catch (err) {
    if (err.code === 11000 && attempt < 3) return getNextSequence(counterName, attempt + 1, step);
    throw err;
  }
};

const generateSKU = async () => `SKU${String(await getNextSequence("PRODUCT_SKU")).padStart(6, "0")}`;
const generateBarcode = async () => `100${String(await getNextSequence("PRODUCT_BARCODE")).padStart(7, "0")}`;

const fmtSku = (n) => `SKU${String(n).padStart(6, "0")}`;
const fmtBarcode = (n) => `100${String(n).padStart(7, "0")}`;

/**
 * Reserve `count` SKUs and barcodes with ONE atomic counter update each,
 * instead of two database round trips per row.
 */
const reserveCodes = async (count) => {
  if (count <= 0) return { skus: [], barcodes: [] };
  const [skuEnd, barEnd] = await Promise.all([
    getNextSequence("PRODUCT_SKU", 0, count),
    getNextSequence("PRODUCT_BARCODE", 0, count),
  ]);
  const range = (end, fmt) => Array.from({ length: count }, (_, i) => fmt(end - count + 1 + i));
  return { skus: range(skuEnd, fmtSku), barcodes: range(barEnd, fmtBarcode) };
};

module.exports = { generateSKU, generateBarcode, reserveCodes };