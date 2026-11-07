/**
 * Full FY label as stored on FinancialYear (legacy), e.g. "2026-27".
 * New financial years use the short label from generateFYLabelFromStartYear.
 */
export const getFYDocumentCode = (label) => String(label ?? "").trim();

/** Canonical short FY label, e.g. "26-27". Converts legacy "2026-27"; already-short values pass through. */
export const getFYShortLabel = (label) => {
  const trimmed = String(label ?? "").trim();
  if (!trimmed) return trimmed;

  const legacy = trimmed.match(/^(\d{4})-(\d{2,4})$/);
  if (legacy) {
    const startShort = legacy[1].slice(-2);
    const endPart = legacy[2];
    const endShort = endPart.length === 4 ? endPart.slice(-2) : endPart;
    return `${startShort}-${endShort}`;
  }

  return trimmed;
};

/** Indian FY from April start year: 2026 → "26-27", 2027 → "27-28". */
export const generateFYLabelFromStartYear = (startYear) => {
  const y = Number(startYear);
  if (!Number.isFinite(y)) return "";
  const endYear = y + 1;
  return `${String(y).slice(-2)}-${String(endYear).slice(-2)}`;
};

/** Last numeric segment of PINV-2026-27-0001 (also handles legacy formats) */
export const getDocumentSequence = (docNo) => {
  const parts = String(docNo ?? "").split("-");
  return parseInt(parts[parts.length - 1], 10) || 0;
};
