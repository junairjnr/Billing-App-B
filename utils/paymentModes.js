/** Payment modes that post to the Bank ledger (1310), not Cash (1300). */
export const BANK_PAYMENT_MODES = new Set([
  "bank",
  "bank_transfer",
  "upi",
  "cheque",
  "card",
]);

export const isCashPaymentMode = (mode) => mode === "cash";

export const isBankPaymentMode = (mode) => BANK_PAYMENT_MODES.has(mode);

export const needsBankAccount = (mode) => isBankPaymentMode(mode);
