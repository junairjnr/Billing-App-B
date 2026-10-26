import ApiError from "./ApiError.js";

/** Reject NoSQL operator injection via object/array query values. */
export const requireString = (value, fieldName, { maxLength = 500 } = {}) => {
  if (typeof value !== "string") {
    throw new ApiError(400, `${fieldName} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ApiError(400, `${fieldName} is required`);
  }
  if (trimmed.length > maxLength) {
    throw new ApiError(400, `${fieldName} is too long`);
  }
  return trimmed;
};

const objectIdHexPattern = /^[a-f\d]{24}$/i;

/** Coerce JWT / Mongoose ObjectId / populated `{ _id }` refs to a 24-char hex string. */
export const normalizeObjectIdString = (value) => {
  if (value == null || value === "") return null;
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") {
    if (typeof value.toHexString === "function") {
      return value.toHexString();
    }
    if (value._id != null) {
      return normalizeObjectIdString(value._id);
    }
  }
  return null;
};

/** Optional id filter — undefined when blank, rejected when not a valid ObjectId. */
export const optionalObjectId = (value, fieldName = "Id") => {
  if (value == null || value === "") return undefined;
  const normalized = normalizeObjectIdString(value);
  if (!normalized || !objectIdHexPattern.test(normalized)) {
    throw new ApiError(400, `Invalid ${fieldName}`);
  }
  return normalized;
};

export const optionalSearchString = (value, maxLength = 100) => {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new ApiError(400, "Search must be a string");
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
};

/** Whitelist string query values (status, salesType, etc.). */
export const optionalEnum = (value, allowed, fieldName) => {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new ApiError(400, `${fieldName} must be a string`);
  }
  const trimmed = value.trim();
  if (!allowed.includes(trimmed)) {
    throw new ApiError(400, `Invalid ${fieldName}`);
  }
  return trimmed;
};

export const assignOptionalObjectId = (filter, query, fieldName, label = fieldName) => {
  const id = optionalObjectId(query[fieldName], label);
  if (id) filter[fieldName] = id;
};
