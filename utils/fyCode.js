/**
 * Full FY label as stored on FinancialYear, e.g. "2026-27".
 * Prefer getFYShortLabel for new document numbers.
 */
export const getFYDocumentCode = (label) => String(label ?? "").trim();

/** FY segment in slash invoice/return numbers: "2026-27" → "26-27". */
export const getFYShortLabel = (label) => {
  const trimmed = String(label ?? "").trim();
  const match = trimmed.match(/^(\d{4})-(\d{2,4})$/);
  if (!match) return trimmed;
  const startShort = match[1].slice(-2);
  const endPart = match[2];
  const endShort = endPart.length === 4 ? endPart.slice(-2) : endPart;
  return `${startShort}-${endShort}`;
};

/** Last numeric segment of PINV-2026-27-0001 (also handles legacy formats) */
export const getDocumentSequence = (docNo) => {
  const parts = String(docNo ?? "").split("-");
  return parseInt(parts[parts.length - 1], 10) || 0;
};
