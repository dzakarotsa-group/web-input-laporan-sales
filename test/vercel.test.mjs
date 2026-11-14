import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

process.env.NODE_ENV = "test";
process.env.GOOGLE_SHEETS_SPREADSHEET_ID = "";
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = "";
process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 = "";

const { default: vercelHandler } = await import("../api/index.mjs");

test("Vercel adapter restores rewritten API paths", async () => {
  const server = createServer(vercelHandler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/index?__lead_desk_path=%2Fapi%2Fhealth`
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).mode, "demo");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
