import assert from "node:assert/strict";
import { test } from "node:test";
import { sundayToSaturdayRange, visitDateThisWeek } from "../visit-schedule.js";

test("visit weekdays in FU results map to dates in the current Sunday-Saturday week", () => {
  const weekStart = "2026-11-08";
  assert.deepEqual(sundayToSaturdayRange("2026-11-14"), [weekStart, "2026-11-14"]);
  const lead = {
    visitBooked: true,
    visitCompleted: false,
    followUps: [{
      number: 2,
      result: "Janji visit hari Minggu",
      createdAt: "2026-11-14T06:00:00.000Z"
    }]
  };
  assert.equal(visitDateThisWeek(lead, weekStart), "2026-11-08");

  lead.followUps[0].result = "Visit hari Sabtu";
  assert.equal(visitDateThisWeek(lead, weekStart), "2026-11-14");
});

test("visit dates require an active plan and an explicit visit weekday", () => {
  const lead = {
    visitBooked: true,
    visitCompleted: false,
    followUps: [{
      number: 2,
      result: "Visit minggu depan",
      createdAt: "2026-11-14T06:00:00.000Z"
    }]
  };
  assert.equal(visitDateThisWeek(lead, "2026-11-08"), "");

  lead.followUps[0].result = "Janji visit hari Senin";
  lead.visitBooked = false;
  assert.equal(visitDateThisWeek(lead, "2026-11-08"), "");

  lead.visitBooked = true;
  lead.visitCompleted = true;
  assert.equal(visitDateThisWeek(lead, "2026-11-08"), "");
});
