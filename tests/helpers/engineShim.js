/**
 * Test-only engine shim (never loaded by the app).
 *
 * FerretDB – the stand-in database used where no real MongoDB exists – can't evaluate several aggregation
 * operators / `$expr` and mis-sums multiple accumulators. When that is detected we route `aggregate()` and `$expr`
 * queries through `mingo` (an independent MongoDB query engine) over the documents actually stored in the
 * database. The REAL controllers still run end-to-end; only the query evaluation moves.
 * Against a real MongoDB none of this is installed.
 */
const mongoose = require("mongoose");
const { Aggregator, Query } = require("mingo");

const engineNeedsShim = async () => {
  const col = mongoose.connection.db.collection("shim_probe");
  await col.insertOne({ a: 1, status: "x" });
  try {
    const [row] = await col.aggregate([{ $group: { _id: null, n: { $sum: 1 }, m: { $sum: { $cond: [{ $eq: ["$status", "x"] }, 1, 0] } } } }]).toArray();
    return !(row && row.n === 1 && row.m === 1);
  } catch { return true; }
};

const installShim = () => {
  const Product = require("../../models/Productmodel");
  const POSSale = require("../../models/POSSaleModel");
  const docs = (M) => M.collection.find({}).toArray();
  const thenable = (fn) => ({ then: (res, rej) => fn().then(res, rej), catch: (rej) => fn().catch(rej) });

  POSSale.aggregate = (pipeline) => thenable(async () => new Aggregator(pipeline).run(await docs(POSSale)));
  const origAgg = Product.aggregate.bind(Product);
  Product.aggregate = (pipeline) => (JSON.stringify(pipeline[0] || {}).includes("lowStock") ? thenable(async () => new Aggregator(pipeline).run(await docs(Product))) : origAgg(pipeline));

  const origFind = Product.find.bind(Product);
  const origCount = Product.countDocuments.bind(Product);
  const usesExpr = (f) => f && typeof f === "object" && "$expr" in f;
  Product.find = (filter, ...rest) => {
    if (!usesExpr(filter)) return origFind(filter, ...rest);
    const st = { sort: null, skip: 0, limit: Infinity };
    const chain = {
      select: () => chain, populate: () => chain, lean: () => chain,
      sort: (s) => { st.sort = s; return chain; }, skip: (n) => { st.skip = n; return chain; }, limit: (n) => { st.limit = n; return chain; },
      then: (res, rej) => (async () => {
        let out = new Query(filter).find(await docs(Product)).all();
        if (st.sort) { const [[k, d]] = Object.entries(st.sort); out = out.sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * d); }
        return out.slice(st.skip, st.skip + st.limit);
      })().then(res, rej),
    };
    return chain;
  };
  Product.countDocuments = (filter, ...rest) => (usesExpr(filter) ? thenable(async () => new Query(filter).find(await docs(Product)).all().length) : origCount(filter, ...rest));
};

module.exports = { installShim, engineNeedsShim };
