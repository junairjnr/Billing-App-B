/** Transaction lists — most recently saved record first. */
export const transactionListSort = { createdAt: -1 };

/** Reports / exports — newest document date first, then creation time. */
export const purchaseInvoiceReportSort = { purchaseDate: -1, createdAt: -1 };
export const purchaseReturnReportSort = { returnDate: -1, createdAt: -1 };

export const compareByDateThenCreated = (dateField) => (a, b) => {
  const dateDiff =
    new Date(b[dateField]).getTime() - new Date(a[dateField]).getTime();
  if (dateDiff !== 0) return dateDiff;
  return (
    new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  );
};
