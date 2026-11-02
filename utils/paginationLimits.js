/** Maximum rows returned by generic list endpoints (DoS / memory protection). */
export const MAX_PAGE_SIZE = 500;

/** Typeahead / master dropdown search (products, parties, etc.). */
export const MAX_LOOKUP_SIZE = 2000;

export const clampPageSize = (limit, fallback = 20) => {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), MAX_PAGE_SIZE);
};

export const clampLookupSize = (limit, fallback = MAX_LOOKUP_SIZE) => {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), MAX_LOOKUP_SIZE);
};

export const clampPage = (page) => {
  const n = Number(page);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.floor(n);
};
