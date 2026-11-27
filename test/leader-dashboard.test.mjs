import test from "node:test";
import assert from "node:assert/strict";
import { leadsForDashboard } from "../leader-dashboard.js";

const leads = [
  { id: "leader-lead", isOwnLead: true, ownerId: "leader-1" },
  { id: "merry-lead", isOwnLead: false, ownerId: "sales-merry" },
  { id: "other-lead", isOwnLead: false, ownerId: "sales-other" }
];

test("leader overview only shows leads owned by the leader", () => {
  assert.deepEqual(leadsForDashboard(leads, "leader"), [leads[0]]);
});

test("leader team dashboard only shows the selected salesperson's leads", () => {
  assert.deepEqual(leadsForDashboard(leads, "leader", "sales-merry"), [leads[1]]);
});

test("sales dashboard keeps its own lead list unchanged", () => {
  assert.deepEqual(leadsForDashboard(leads, "sales"), leads);
});
