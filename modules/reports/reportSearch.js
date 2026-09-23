import { optionalSearchString } from "../../utils/sanitizeInput.js";

/** Case-insensitive contains matcher for report rows assembled in memory. */
export const reportSearchMatcher = (search) => {
  const needle = optionalSearchString(search)?.toLowerCase();
  if (!needle) return () => true;
  return (...values) =>
    values.some((value) => String(value ?? "").toLowerCase().includes(needle));
};
