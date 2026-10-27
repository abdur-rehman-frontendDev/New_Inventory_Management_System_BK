process.env.JWT_SECRET = "test-secret";
process.env.MONGODB_URL = "mongodb://127.0.0.1:1/none";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const http = require("node:http");

// Stub the DB connection so the HTTP layer can be tested without MongoDB.
const mongoPath = require.resolve("../libs/mongoconfig");
require.cache[mongoPath] = { id: mongoPath, filename: mongoPath, loaded: true, exports: { MongoDBconfig: async () => {} } };
const app = require("../api/index");

let server, base;
test.before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const call = (method, url, body, headers = {}) =>
  fetch(base + url, { method, headers: { "Content-Type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });

// Every one of these used to be reachable WITHOUT logging in.
const protectedRoutes = [
  ["GET", "/api/supplier/getallsupplier"],
  ["DELETE", "/api/supplier/507f1f77bcf86cd799439011"],
  ["POST", "/api/stocktransaction/createStockTransaction"],
  ["GET", "/api/stocktransaction/getallStockTransaction"],
  ["GET", "/api/inventory/inventory"],
  ["GET", "/api/notification/allNotification"],
  ["POST", "/api/notification/createNotification"],
  ["GET", "/api/posSales/all"],
  ["POST", "/api/posSales/create"],
  ["PUT", "/api/posSales/cancel/507f1f77bcf86cd799439011"],
  ["GET", "/api/sales/getallsales"],
  ["POST", "/api/sales/createsales"],
  ["DELETE", "/api/auth/removeuser/507f1f77bcf86cd799439011"],
  ["GET", "/api/category/getcategory"],
  ["GET", "/api/product/getproduct"],
  ["GET", "/api/reports/summary"],
  ["GET", "/api/dashboard/summary"],
  ["GET", "/api/activitylogs/getAllLogs"],
  ["GET", "/api/order/getorders"],
];

for (const [method, url] of protectedRoutes) {
  test(`401 without token: ${method} ${url}`, async () => {
    const res = await call(method, url, method === "GET" ? undefined : {});
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.equal(json.success, false);
    assert.ok(json.message);
  });
}

test("a forged token is rejected", async () => {
  const res = await call("GET", "/api/product/getproduct", null, { Authorization: "Bearer not.a.jwt" });
  assert.equal(res.status, 401);
});

test("login validates input types before touching the DB", async () => {
  const res = await call("POST", "/api/auth/login", { email: { $ne: null }, password: "x" });
  assert.equal(res.status, 400);
});

test("signup validates the password policy", async () => {
  const res = await call("POST", "/api/auth/signup", { name: "Eve", email: "eve@x.com", password: "weak" });
  assert.equal(res.status, 400);
});

test("unknown routes return JSON 404, malformed JSON returns 400", async () => {
  const nf = await call("GET", "/api/nope");
  assert.equal(nf.status, 404);
  assert.equal((await nf.json()).success, false);
  const bad = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{bad" });
  assert.equal(bad.status, 400);
});

test("CORS: allowed origin is echoed, unknown origin is not; preflight answers", async () => {
  const ok = await fetch(base + "/health", { headers: { Origin: "http://localhost:5173" } });
  assert.equal(ok.headers.get("access-control-allow-origin"), "http://localhost:5173");
  const evil = await fetch(base + "/health", { headers: { Origin: "https://evil.example" } });
  assert.equal(evil.headers.get("access-control-allow-origin"), null);
  const pre = await fetch(base + "/api/product/addproduct", { method: "OPTIONS", headers: { Origin: "http://localhost:5173", "Access-Control-Request-Method": "POST" } });
  assert.ok(pre.status === 204 || pre.status === 200);
});

test("security headers are present", async () => {
  const res = await fetch(base + "/health");
  assert.ok(res.headers.get("x-content-type-options"));
  assert.equal(res.headers.get("x-powered-by"), null);
});
