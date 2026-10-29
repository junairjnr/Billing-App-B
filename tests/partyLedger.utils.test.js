import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPartyLineBalance,
  partyLineMatches,
  partySubLedgerAccountCode,
} from "../modules/accounting/reports/partyLedger.utils.js";

const partyId = "507f1f77bcf86cd799439011";

test("partySubLedgerAccountCode maps customer and vendor", () => {
  assert.equal(partySubLedgerAccountCode("customer"), "1100");
  assert.equal(partySubLedgerAccountCode("vendor"), "2100");
  assert.equal(partySubLedgerAccountCode("Vendor"), "2100");
});

test("partyLineMatches only AR/AP lines for the party", () => {
  const arLine = {
    accountCode: "1100",
    customerId: partyId,
    debit: 100,
    credit: 0,
  };
  const salesLine = {
    accountCode: "4100",
    customerId: partyId,
    debit: 0,
    credit: 100,
  };

  assert.equal(partyLineMatches(arLine, "customer", partyId), true);
  assert.equal(partyLineMatches(salesLine, "customer", partyId), false);
  assert.equal(partyLineMatches(arLine, "customer", "507f1f77bcf86cd799439012"), false);
});

test("applyPartyLineBalance increases receivable on debit", () => {
  const line = { debit: 500, credit: 0 };
  assert.equal(applyPartyLineBalance(0, line, "customer"), 500);
  assert.equal(applyPartyLineBalance(500, { debit: 0, credit: 200 }, "customer"), 300);
});

test("applyPartyLineBalance increases payable on credit", () => {
  assert.equal(
    applyPartyLineBalance(0, { debit: 0, credit: 800 }, "vendor"),
    800
  );
  assert.equal(
    applyPartyLineBalance(800, { debit: 300, credit: 0 }, "vendor"),
    500
  );
});
