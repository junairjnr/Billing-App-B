import mongoose from "mongoose";
import JournalEntry from "../journal/journalEntry.model.js";
import ChartOfAccount from "../chartOfAccount/chartOfAccount.model.js";
import Customer from "../../masters/customer/customer.model.js";
import ApiError from "../../../utils/ApiError.js";
import { normalizeObjectIdString } from "../../../utils/sanitizeInput.js";
import {
  applyPartyLineBalance,
  normalizePartyType,
  partyIdFromLine,
  partyLineMatches,
  partySubLedgerAccountCode,
} from "./partyLedger.utils.js";

const round2 = (n) => Number(Number(n).toFixed(2));

/** Match string or ObjectId storage (JWT / auth may send hex strings). */
const scopeIdMatch = (field, value) => {
  if (value == null || value === "") return null;
  const normalized = normalizeObjectIdString(value);
  if (!normalized || !mongoose.Types.ObjectId.isValid(normalized)) {
    return { [field]: value };
  }
  const oid = new mongoose.Types.ObjectId(normalized);
  return { $or: [{ [field]: normalized }, { [field]: oid }] };
};

const mergeScopeFilters = (...parts) => {
  const clauses = parts.flatMap((part) => {
    if (!part) return [];
    if (part.$and) return part.$and;
    return [part];
  });
  if (clauses.length === 0) return {};
  if (clauses.length === 1) return clauses[0];
  return { $and: clauses };
};

const buildScopeFilter = ({ companyId, branchId, financialYearId, dateFrom, dateTo }) => {
  const clauses = [{ status: "posted" }];

  for (const [field, value] of [
    ["companyId", companyId],
    ["branchId", branchId],
    ["financialYearId", financialYearId],
  ]) {
    const match = scopeIdMatch(field, value);
    if (match) clauses.push(match);
  }

  if (dateFrom || dateTo) {
    const entryDate = {};
    if (dateFrom) entryDate.$gte = new Date(dateFrom);
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      entryDate.$lte = end;
    }
    clauses.push({ entryDate });
  }

  return mergeScopeFilters(...clauses);
};

const normalizePartyId = (partyId) => {
  const normalized = normalizeObjectIdString(partyId);
  if (!normalized || !mongoose.Types.ObjectId.isValid(normalized)) {
    throw new ApiError(400, "Invalid party id");
  }
  return normalized;
};

/** Aggregate journal lines by account */
const aggregateByAccount = async (filter) => {
  const entries = await JournalEntry.find(filter).lean();
  const map = {};

  for (const entry of entries) {
    for (const line of entry.lines) {
      const key = line.accountCode;
      if (!map[key]) {
        map[key] = {
          accountId: line.accountId,
          accountCode: line.accountCode,
          accountName: line.accountName,
          debit: 0,
          credit: 0,
        };
      }
      map[key].debit += line.debit || 0;
      map[key].credit += line.credit || 0;
    }
  }

  return Object.values(map).map((row) => ({
    ...row,
    debit: round2(row.debit),
    credit: round2(row.credit),
    balance: round2(row.debit - row.credit),
  }));
};

export const getTrialBalance = async (scope) => {
  const rows = await aggregateByAccount(buildScopeFilter(scope));
  const accounts = await ChartOfAccount.find({
    companyId: scope.companyId,
    isActive: true,
  })
    .sort({ code: 1 })
    .lean();

  const rowMap = Object.fromEntries(rows.map((r) => [r.accountCode, r]));

  const trialRows = accounts.map((acc) => {
    const agg = rowMap[acc.code] || { debit: 0, credit: 0, balance: 0 };
    const netBalance = round2(agg.debit - agg.credit);

    let debitBalance = 0;
    let creditBalance = 0;

    if (["asset", "expense"].includes(acc.accountType)) {
      debitBalance = netBalance >= 0 ? netBalance : 0;
      creditBalance = netBalance < 0 ? Math.abs(netBalance) : 0;
    } else {
      creditBalance = netBalance <= 0 ? Math.abs(netBalance) : 0;
      debitBalance = netBalance > 0 ? netBalance : 0;
    }

    return {
      accountCode: acc.code,
      accountName: acc.name,
      accountType: acc.accountType,
      debit: agg.debit,
      credit: agg.credit,
      debitBalance: round2(debitBalance),
      creditBalance: round2(creditBalance),
    };
  });

  const totals = trialRows.reduce(
    (acc, r) => ({
      totalDebit: round2(acc.totalDebit + r.debitBalance),
      totalCredit: round2(acc.totalCredit + r.creditBalance),
    }),
    { totalDebit: 0, totalCredit: 0 }
  );

  return { rows: trialRows.filter((r) => r.debit > 0 || r.credit > 0), totals };
};

export const getProfitAndLoss = async (scope) => {
  const rows = await aggregateByAccount(buildScopeFilter(scope));
  const accounts = await ChartOfAccount.find({
    companyId: scope.companyId,
    accountType: { $in: ["income", "expense"] },
    isActive: true,
  }).lean();

  const rowMap = Object.fromEntries(rows.map((r) => [r.accountCode, r]));

  const income = [];
  const expenses = [];
  let totalIncome = 0;
  let totalExpense = 0;

  for (const acc of accounts) {
    const agg = rowMap[acc.code];
    if (!agg) continue;

    const net =
      acc.accountType === "income"
        ? round2(agg.credit - agg.debit)
        : round2(agg.debit - agg.credit);

    if (net === 0) continue;

    const item = { accountCode: acc.code, accountName: acc.name, amount: net };
    if (acc.accountType === "income") {
      income.push(item);
      totalIncome += net;
    } else {
      expenses.push(item);
      totalExpense += net;
    }
  }

  return {
    income,
    expenses,
    totalIncome: round2(totalIncome),
    totalExpense: round2(totalExpense),
    netProfit: round2(totalIncome - totalExpense),
  };
};

export const getBalanceSheet = async (scope) => {
  const rows = await aggregateByAccount(buildScopeFilter(scope));
  const accounts = await ChartOfAccount.find({
    companyId: scope.companyId,
    accountType: { $in: ["asset", "liability", "equity"] },
    isActive: true,
  }).lean();

  const rowMap = Object.fromEntries(rows.map((r) => [r.accountCode, r]));

  const sections = { assets: [], liabilities: [], equity: [] };
  let totalAssets = 0;
  let totalLiabilities = 0;
  let totalEquity = 0;

  for (const acc of accounts) {
    const agg = rowMap[acc.code];
    if (!agg) continue;

    const net =
      acc.accountType === "asset"
        ? round2(agg.debit - agg.credit)
        : round2(agg.credit - agg.debit);

    if (net === 0) continue;

    const item = { accountCode: acc.code, accountName: acc.name, amount: net };

    if (acc.accountType === "asset") {
      sections.assets.push(item);
      totalAssets += net;
    } else if (acc.accountType === "liability") {
      sections.liabilities.push(item);
      totalLiabilities += net;
    } else {
      sections.equity.push(item);
      totalEquity += net;
    }
  }

  const pl = await getProfitAndLoss(scope);

  return {
    ...sections,
    totalAssets: round2(totalAssets),
    totalLiabilities: round2(totalLiabilities),
    totalEquity: round2(totalEquity),
    retainedEarnings: pl.netProfit,
    totalLiabilitiesAndEquity: round2(totalLiabilities + totalEquity + pl.netProfit),
  };
};

/** Customer or vendor sub-ledger from journal lines */
export const getSubLedger = async ({
  companyId,
  branchId,
  financialYearId,
  partyId,
  partyType,
  dateFrom,
  dateTo,
}) => {
  const normalizedType = normalizePartyType(partyType);
  const partyKey = normalizePartyId(partyId);
  const partyOid = new mongoose.Types.ObjectId(partyKey);
  const partyIdField = normalizedType === "customer" ? "customerId" : "vendorId";
  const accountCode = partySubLedgerAccountCode(normalizedType);

  const filter = mergeScopeFilters(
    buildScopeFilter({ companyId, branchId, financialYearId, dateFrom, dateTo }),
    {
      lines: {
        $elemMatch: {
          accountCode,
          $or: [{ [partyIdField]: partyKey }, { [partyIdField]: partyOid }],
        },
      },
    }
  );

  const entries = await JournalEntry.find(filter)
    .sort({ entryDate: 1, createdAt: 1 })
    .lean();

  let runningBalance = 0;
  const transactions = [];

  for (const entry of entries) {
    for (const line of entry.lines) {
      if (!partyLineMatches(line, normalizedType, partyKey)) continue;

      const debit = line.debit || 0;
      const credit = line.credit || 0;
      runningBalance = applyPartyLineBalance(runningBalance, line, normalizedType);

      transactions.push({
        date: entry.entryDate,
        journalNo: entry.journalNo,
        referenceType: entry.referenceType,
        referenceNo: entry.referenceNo,
        narration: line.narration || entry.narration,
        debit,
        credit,
        balance: runningBalance,
      });
    }
  }

  return { transactions, closingBalance: runningBalance };
};

export const getCustomerBalance = async (scope, customerId) => {
  const { closingBalance } = await getSubLedger({
    ...scope,
    partyId: customerId,
    partyType: "customer",
  });
  return { customerId, balance: closingBalance };
};

export const getVendorBalance = async (scope, vendorId) => {
  const { closingBalance } = await getSubLedger({
    ...scope,
    partyId: vendorId,
    partyType: "vendor",
  });
  return { vendorId, balance: closingBalance };
};

export const getGeneralLedger = async ({
  companyId,
  branchId,
  financialYearId,
  accountCode,
  dateFrom,
  dateTo,
}) => {
  const filter = buildScopeFilter({ companyId, branchId, financialYearId, dateFrom, dateTo });
  filter["lines.accountCode"] = accountCode;

  const entries = await JournalEntry.find(filter)
    .sort({ entryDate: 1, createdAt: 1 })
    .lean();

  let runningBalance = 0;
  const transactions = [];

  for (const entry of entries) {
    for (const line of entry.lines) {
      if (line.accountCode !== accountCode) continue;

      runningBalance = round2(runningBalance + (line.debit || 0) - (line.credit || 0));
      transactions.push({
        date: entry.entryDate,
        journalNo: entry.journalNo,
        referenceType: entry.referenceType,
        referenceNo: entry.referenceNo,
        narration: line.narration || entry.narration,
        debit: line.debit || 0,
        credit: line.credit || 0,
        balance: runningBalance,
      });
    }
  }

  return { accountCode, transactions, closingBalance: runningBalance };
};

/** All customer or vendor balances aggregated from journal sub-ledger lines */
export const getAllPartyBalances = async (scope, partyType) => {
  const normalizedType = normalizePartyType(partyType);
  const accountCode = partySubLedgerAccountCode(normalizedType);
  const partyIdField = normalizedType === "customer" ? "customerId" : "vendorId";

  const filter = mergeScopeFilters(buildScopeFilter(scope), {
    lines: {
      $elemMatch: {
        accountCode,
        [partyIdField]: { $exists: true, $ne: null },
      },
    },
  });

  const entries = await JournalEntry.find(filter).lean();
  const balanceMap = {};

  for (const entry of entries) {
    for (const line of entry.lines) {
      const partyKey = partyIdFromLine(line, normalizedType);
      if (!partyKey || line.accountCode !== accountCode) continue;

      if (!balanceMap[partyKey]) balanceMap[partyKey] = 0;
      balanceMap[partyKey] = applyPartyLineBalance(
        balanceMap[partyKey],
        line,
        normalizedType
      );
    }
  }

  const partyIds = Object.keys(balanceMap);
  if (!partyIds.length) return [];

  const typeFilter = normalizedType === "customer" ? "sales" : "purchase";
  const partyObjectIds = partyIds
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const customerFilter = mergeScopeFilters(
    scopeIdMatch("companyId", scope.companyId) ?? {},
    {
      _id: { $in: partyObjectIds },
      type: typeFilter,
    }
  );

  const parties = await Customer.find(customerFilter)
    .select("name phone gstin")
    .lean();

  const partyMap = Object.fromEntries(parties.map((p) => [String(p._id), p]));

  return partyIds
    .map((id) => ({
      partyId: id,
      name: partyMap[id]?.name || "Unknown",
      phone: partyMap[id]?.phone || "",
      balance: balanceMap[id],
    }))
    .filter((row) => Math.abs(row.balance) >= 0.005)
    .sort((a, b) => b.balance - a.balance);
};
