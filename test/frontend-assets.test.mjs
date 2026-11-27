import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { handleRequest } from "../server.mjs";

test("serves the dashboard module imported by the login page", async () => {
  const server = createServer(handleRequest);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/leader-dashboard.js`;

  try {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /leadsForDashboard/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) =>
      error ? reject(error) : resolve()
    ));
  }
});
