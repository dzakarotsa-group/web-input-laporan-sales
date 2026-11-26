import assert from "node:assert/strict";
import { test } from "node:test";
import { whatsappChatUrl } from "../whatsapp-link.js";

test("normalizes Indonesian phone numbers for WhatsApp chat links", () => {
  assert.equal(whatsappChatUrl("0812 3456-7890"), "https://wa.me/6281234567890");
  assert.equal(whatsappChatUrl("+62 (812) 3456-7890"), "https://wa.me/6281234567890");
  assert.equal(whatsappChatUrl("81234567890"), "https://wa.me/6281234567890");
  assert.equal(whatsappChatUrl("001-415-555-2671"), "https://wa.me/14155552671");
});

test("does not create WhatsApp links for missing, masked, or invalid numbers", () => {
  assert.equal(whatsappChatUrl(""), "");
  assert.equal(whatsappChatUrl("0812•••••321"), "");
  assert.equal(whatsappChatUrl("0812abc789"), "");
  assert.equal(whatsappChatUrl("12345"), "");
});
