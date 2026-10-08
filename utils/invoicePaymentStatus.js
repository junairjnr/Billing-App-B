/** Net receivable/payable after sales or purchase returns. */
export const getEffectiveInvoiceTotal = (inv) =>
  Math.max(
    0,
    Number(
      (Number(inv?.grandTotal || 0) - Number(inv?.returnedAmount || 0)).toFixed(2)
    )
  );

export const computeInvoiceBalance = (inv) => {
  const paid = Number(inv?.paidAmount ?? 0);
  const effectiveTotal = getEffectiveInvoiceTotal(inv);
  return Math.max(0, Number((effectiveTotal - paid).toFixed(2)));
};

/** Nothing due (incl. fully returned with no payment) → paid. */
export const computePaymentStatus = (inv) => {
  const balance = computeInvoiceBalance(inv);
  if (balance <= 0.009) return "paid";
  const effectiveTotal = getEffectiveInvoiceTotal(inv);
  const paid = Number(inv?.paidAmount ?? 0);
  if (paid <= 0) return "pending";
  if (paid >= effectiveTotal - 0.009) return "paid";
  return "partial";
};
