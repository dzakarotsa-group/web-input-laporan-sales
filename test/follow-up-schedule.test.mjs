import assert from "node:assert/strict";
import { test } from "node:test";
import { computeDueFollowUp, hasFollowUpToday } from "../follow-up-schedule.js";

test("counts FU 1 only when its own date is today", () => {
  const lead = {
    followUps: [{
      number: 1,
      result: "Lead masuk",
      followUpDate: "2026-11-23",
      createdAt: "2026-11-23T04:00:00.000Z"
    }]
  };

  assert.equal(hasFollowUpToday(lead, "2026-11-24"), false);
  lead.followUps[0].followUpDate = "2026-11-24";
  assert.equal(hasFollowUpToday(lead, "2026-11-24"), true);
  lead.followUps.push({
    number: 2,
    result: "Sudah dihubungi",
    followUpDate: "2026-11-24"
  });
  assert.equal(hasFollowUpToday(lead, "2026-11-24"), true);
});

test("uses the Jakarta date when a follow-up has only a timestamp", () => {
  const lead = {
    followUps: [{
      number: 2,
      result: "Sudah dihubungi",
      createdAt: "2026-11-23T18:00:00.000Z"
    }]
  };

  assert.equal(hasFollowUpToday(lead, "2026-11-24"), true);
});

test("starts FU 2 at H+3 and advances to H+5 after it is completed", () => {
  const lead = {
    createdAt: "2026-11-01T04:00:00.000Z",
    tahap: "Komunikasi",
    followUps: [{ number: 1, result: "Lead masuk" }]
  };

  assert.equal(computeDueFollowUp(lead, "2026-11-03"), null);
  assert.deepEqual(computeDueFollowUp(lead, "2026-11-04"), {
    number: 2,
    label: "H+3",
    daysOverdue: 0
  });
  assert.deepEqual(computeDueFollowUp(lead, "2026-11-06"), {
    number: 2,
    label: "H+3",
    daysOverdue: 2
  });

  lead.followUps.push({ number: 2, result: "Sudah dihubungi" });
  assert.deepEqual(computeDueFollowUp(lead, "2026-11-06"), {
    number: 3,
    label: "H+5",
    daysOverdue: 0
  });
});

test("does not report future intervals or leads at terminal stages", () => {
  const lead = {
    createdAt: "2026-11-01",
    tahap: "Survey",
    followUps: [{ number: 2, result: "Sudah dihubungi" }]
  };

  assert.equal(computeDueFollowUp(lead, "2026-11-03"), null);
  lead.tahap = "Batal";
  assert.equal(computeDueFollowUp(lead, "2026-11-20"), null);
});
