import assert from "node:assert/strict";
import { test } from "node:test";
import { inferLeadIndicator, latestCommunication } from "../lead-indicator.js";

test("classifies clear COLD, WARM, and HOT follow-up messages", () => {
  assert.equal(inferLeadIndicator("Belum membalas pesan setelah dihubungi"), "COLD");
  assert.equal(inferLeadIndicator("Tanya promo, cicilan, dan rincian biaya"), "WARM");
  assert.equal(inferLeadIndicator("Siap survey lokasi besok"), "HOT");
});

test("keeps unclear or mixed follow-up messages unclassified", () => {
  assert.equal(inferLeadIndicator("Masih dipertimbangkan"), null);
  assert.equal(inferLeadIndicator("Tanya simulasi cicilan dan siap survey lokasi"), null);
  assert.equal(inferLeadIndicator("Belum siap survey lokasi"), null);
  assert.equal(inferLeadIndicator(""), null);
});

test("uses the most recent non-empty follow-up communication", () => {
  assert.equal(latestCommunication({
    createdAt: "2026-06-01",
    followUps: [
      { number: 2, followUpDate: "2026-06-03", result: "Tanya promo" },
      { number: 3, followUpDate: "2026-06-04", result: "Siap survey lokasi" },
      { number: 4, followUpDate: "2026-06-05", result: "" }
    ]
  }), "Siap survey lokasi");
});
