import LedgerEntry from "./ledgerEntry.model.js";

const cashAccountName = (mode) =>
  mode === "bank" || mode === "bank_transfer" ? "Bank" : "Cash";

export const createLedgerEntries = async (
  {
    companyId,
    branchId,
    financialYearId,
    receiptPaymentId,
    voucherNo,
    entryDate,
    voucherType,
    partyId,
    partyName,
    paymentMode,
    bankAccountId,
    bankAccountName,
    totalAmount,
  },
  session
) => {
  const entries = [];
  const cashSide = paymentMode === "bank" || paymentMode === "bank_transfer" ? "bank" : "cash";
  const cashName =
    cashSide === "bank" && bankAccountName ? bankAccountName : cashAccountName(paymentMode);

  if (voucherType === "receipt") {
    entries.push(
      {
        companyId,
        branchId,
        financialYearId,
        receiptPaymentId,
        voucherNo,
        entryDate,
        accountType: cashSide,
        accountId: bankAccountId || null,
        accountName: cashName,
        debit: totalAmount,
        credit: 0,
        narration: `Receipt ${voucherNo}`,
      },
      {
        companyId,
        branchId,
        financialYearId,
        receiptPaymentId,
        voucherNo,
        entryDate,
        accountType: "customer",
        accountId: partyId,
        accountName: partyName,
        debit: 0,
        credit: totalAmount,
        narration: `Receipt ${voucherNo}`,
      }
    );
  } else {
    entries.push(
      {
        companyId,
        branchId,
        financialYearId,
        receiptPaymentId,
        voucherNo,
        entryDate,
        accountType: "vendor",
        accountId: partyId,
        accountName: partyName,
        debit: totalAmount,
        credit: 0,
        narration: `Payment ${voucherNo}`,
      },
      {
        companyId,
        branchId,
        financialYearId,
        receiptPaymentId,
        voucherNo,
        entryDate,
        accountType: cashSide,
        accountId: bankAccountId || null,
        accountName: cashName,
        debit: 0,
        credit: totalAmount,
        narration: `Payment ${voucherNo}`,
      }
    );
  }

  return LedgerEntry.insertMany(entries, { session });
};

export const reverseLedgerEntries = async (receiptPaymentId, session) => {
  await LedgerEntry.deleteMany({ receiptPaymentId }, { session });
};
