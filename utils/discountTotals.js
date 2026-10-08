/** Sum of line quantities on an invoice or return. */
export const sumDocumentItemQty = (items = []) =>
  Number(
    (items ?? []).reduce((sum, row) => sum + Number(row?.qty ?? 0), 0).toFixed(3)
  );

/** Line discounts plus the cash discount of a sales/purchase document. */
export const getDocumentDiscountAmount = (doc) => {
  const lineDiscount = (doc?.items ?? []).reduce(
    (sum, item) => sum + Number(item?.discountAmt || 0),
    0
  );
  return Number((lineDiscount + Number(doc?.cashDiscountAmt || 0)).toFixed(2));
};
