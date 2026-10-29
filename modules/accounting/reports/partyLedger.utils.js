import { COA } from "../chartOfAccount/defaultAccounts.js";
import { normalizeObjectIdString } from "../../../utils/sanitizeInput.js";

const round2 = (n) => Number(Number(n).toFixed(2));

export const normalizePartyType = (partyType) =>
  String(partyType ?? "").toLowerCase() === "vendor" ? "vendor" : "customer";

export const partySubLedgerAccountCode = (partyType) =>
  normalizePartyType(partyType) === "vendor"
    ? COA.ACCOUNTS_PAYABLE
    : COA.ACCOUNTS_RECEIVABLE;

export const partyIdFromLine = (line, partyType) =>
  normalizeObjectIdString(
    normalizePartyType(partyType) === "customer" ? line.customerId : line.vendorId
  );

/** True when line is AR/AP for the party (sub-ledger line). */
export const partyLineMatches = (line, partyType, partyKey) => {
  if (!line || !partyKey) return false;
  if (line.accountCode !== partySubLedgerAccountCode(partyType)) return false;
  const lineParty = partyIdFromLine(line, partyType);
  return lineParty != null && lineParty === partyKey;
};

export const applyPartyLineBalance = (balance, line, partyType) => {
  const debit = line.debit || 0;
  const credit = line.credit || 0;
  if (normalizePartyType(partyType) === "customer") {
    return round2(balance + debit - credit);
  }
  return round2(balance + credit - debit);
};
