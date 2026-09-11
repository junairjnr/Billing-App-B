/** Indian number grouping — no currency symbol. */
export const formatMoneyAmount = (n, decimals = 2) =>
  (Number(n) || 0).toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

/** Display/export currency — Rs. prefix (PDF-safe, Excel-friendly). */
export const fmtMoney = (n, decimals = 2) => `Rs. ${formatMoneyAmount(n, decimals)}`;

/** Parse formatted currency strings back to numbers for Excel cells. */
export const parseMoneyValue = (value) => {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  if (!trimmed || trimmed === "—" || trimmed === "-") return value;

  const cleaned = trimmed
    .replace(/\u20B9/g, "")
    .replace(/^Rs\.?\s*/i, "")
    .replace(/,/g, "")
    .trim();

  const num = Number(cleaned);
  return Number.isFinite(num) ? num : value;
};
