// node -r ./tests/helpers/e2e-preload.js server.js   → run the real server on FerretDB with the engine shim (QA only)
require("./engineShim").installShim();
