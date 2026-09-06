import assert from "node:assert/strict";
import { canSellInventoryStatus, canTransitionInventoryStatus } from "../lib/inventory-policy.ts";

assert.equal(canSellInventoryStatus("AVAILABLE"), true);
assert.equal(canSellInventoryStatus("SOLD"), false);
assert.equal(canSellInventoryStatus("TRADE_PENDING"), false);
assert.equal(canTransitionInventoryStatus("AVAILABLE", "SOLD"), true);
assert.equal(canTransitionInventoryStatus("AVAILABLE", "TRADE_PENDING"), true);
assert.equal(canTransitionInventoryStatus("TRADE_PENDING", "TRADE_SENT"), true);
assert.equal(canTransitionInventoryStatus("TRADE_SENT", "TRADE_ACCEPTED"), true);
assert.equal(canTransitionInventoryStatus("TRADE_SENT", "TRADE_FAILED"), true);
assert.equal(canTransitionInventoryStatus("SOLD", "AVAILABLE"), false);
assert.equal(canTransitionInventoryStatus("TRADE_ACCEPTED", "AVAILABLE"), false);
console.log("inventory-policy: PASS");
