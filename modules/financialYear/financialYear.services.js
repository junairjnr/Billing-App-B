import FinancialYear from "./financialYear.model.js";
import ApiError from "../../utils/ApiError.js";
import {
  generateFYLabelFromStartYear,
  getFYShortLabel,
} from "../../utils/fyCode.js";

// ── Determine current FY start year ──────────────────────────
// Indian FY: April 1 to March 31
// If current month >= April (3), FY started this year
// If current month < April, FY started last year
export const getCurrentFYStartYear = () => {
  const now = new Date();
  const month = now.getMonth(); // 0-indexed (March = 2, April = 3)
  return month >= 3 ? now.getFullYear() : now.getFullYear() - 1;
};

const presentFY = (doc) => {
  if (!doc) return doc;
  const raw = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  return { ...raw, label: getFYShortLabel(raw.label) };
};

/** Persist short label when legacy "2026-27" exists (no duplicate short slug). */
const maybeMigrateFYLabel = async (fy) => {
  const short = getFYShortLabel(fy.label);
  if (!short || short === fy.label) return fy;

  const clash = await FinancialYear.findOne({
    companyId: fy.companyId,
    label: short,
    _id: { $ne: fy._id },
  });
  if (clash) return fy;

  fy.label = short;
  await fy.save();
  return fy;
};

// ── Create FY ─────────────────────────────────────────────────
export const createFinancialYear = async (companyId, startYear) => {
  const label = generateFYLabelFromStartYear(startYear);
  if (!label) throw new ApiError(400, "Invalid start year");

  const startDate = new Date(`${startYear}-04-01`);
  const endDate = new Date(`${startYear + 1}-03-31`);

  const exists = await FinancialYear.findOne({ companyId, startDate });
  if (exists) {
    throw new ApiError(
      409,
      `Financial year ${getFYShortLabel(exists.label) || label} already exists`
    );
  }

  // Deactivate all existing FYs — new one becomes active
  await FinancialYear.updateMany({ companyId }, { isActive: false });

  const created = await FinancialYear.create({
    companyId,
    label,
    startDate,
    endDate,
    isActive: true,
    isClosed: false,
  });

  return presentFY(created);
};

// ── Get all FYs for company ───────────────────────────────────
export const getAllFY = async (companyId) => {
  const list = await FinancialYear.find({ companyId }).sort({ startDate: -1 });
  await Promise.all(list.map((fy) => maybeMigrateFYLabel(fy)));
  return list.map(presentFY);
};

// ── Get active FY ─────────────────────────────────────────────
export const getActiveFY = async (companyId) => {
  const fy = await FinancialYear.findOne({ companyId, isActive: true });
  if (!fy)
    throw new ApiError(404, "No active financial year. Please create one.");
  await maybeMigrateFYLabel(fy);
  return presentFY(fy);
};

// ── Switch active FY ──────────────────────────────────────────
export const switchFY = async (companyId, fyId) => {
  const fy = await FinancialYear.findOne({ _id: fyId, companyId });
  if (!fy) throw new ApiError(404, "Financial year not found");
  if (fy.isClosed)
    throw new ApiError(400, "Cannot switch to a closed financial year");

  // Deactivate all → activate selected
  await FinancialYear.updateMany({ companyId }, { isActive: false });
  fy.isActive = true;
  await fy.save();
  await maybeMigrateFYLabel(fy);
  return presentFY(fy);
};

// ── Close FY — permanent lock ─────────────────────────────────
export const closeFY = async (companyId, fyId) => {
  const fy = await FinancialYear.findOne({ _id: fyId, companyId });
  if (!fy) throw new ApiError(404, "Financial year not found");
  if (fy.isClosed) throw new ApiError(400, "Already closed");

  fy.isClosed = true;
  fy.isActive = false;
  await fy.save();
  await maybeMigrateFYLabel(fy);

  // Auto-activate latest open FY if exists
  const latest = await FinancialYear.findOne({
    companyId,
    isClosed: false,
  }).sort({ startDate: -1 });
  if (latest) {
    latest.isActive = true;
    await latest.save();
    await maybeMigrateFYLabel(latest);
  }

  return presentFY(fy);
};

//Delete FY
export const deleteFY = async (companyId, fyId) => {
  const fy = await FinancialYear.findOneAndDelete({ _id: fyId, companyId });
  if (!fy) throw new ApiError(404, "Financial year not found");

  return presentFY(fy);
};
