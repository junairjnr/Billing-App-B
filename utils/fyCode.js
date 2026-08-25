/**
 * FY label "2026-27" → document segment "2026-2027"
 * Used in PINV / RCPT / PAY number prefixes.
 */
export const getFYDocumentCode = (label) => {
  const parts = String(label ?? "").trim().split("-");
  if (parts.length !== 2) return String(label ?? "");

  const startYear = parseInt(parts[0], 10);
  if (!Number.isFinite(startYear)) return String(label ?? "");

  const endPart = parts[1];
  const endYear =
    endPart.length === 2
      ? startYear - (startYear % 100) + parseInt(endPart, 10)
      : parseInt(endPart, 10);

  if (!Number.isFinite(endYear)) return String(label ?? "");

  return `${startYear}-${endYear}`;
};

/** Last segment of PINV-2026-2027-0001 or PINV-2627-0001 */
export const getDocumentSequence = (docNo) => {
  const parts = String(docNo ?? "").split("-");
  return parseInt(parts[parts.length - 1], 10) || 0;
};
