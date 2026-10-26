/** Maximum rows returned by generic list endpoints (DoS / memory protection). */
export const MAX_PAGE_SIZE = 100;

export const clampPageSize = (limit, fallback = 20) => {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), MAX_PAGE_SIZE);
};

export const clampPage = (page) => {
  const n = Number(page);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.floor(n);
};
