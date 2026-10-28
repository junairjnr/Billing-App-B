import mongoose from "mongoose";
import SalesInvoice from "../salesInvoice/salesInvoice.model.js";
import SalesReturn from "./salesReturn.model.js";
import { sessionOpts } from "../../../utils/withTransaction.js";
import {
  computeInvoiceBalance,
  computePaymentStatus,
} from "../../../utils/invoicePaymentStatus.js";
import { escapeRegex } from "../../../utils/escapeRegex.js";
import { optionalObjectId } from "../../../utils/sanitizeInput.js";

const MANUAL_RETURN_BASE_FILTER = {
  returnMode: "manual",
  status: "confirmed",
  isActive: { $ne: false },
};

export const remainingManualReturnCredit = (salesReturn) => {
  const grandTotal = Number(salesReturn?.grandTotal || 0);
  if (grandTotal <= 0) return 0;
  let applied = Number(salesReturn?.appliedCreditAmount || 0);
  if (applied <= 0 && salesReturn?.salesInvoiceId) {
    applied = grandTotal;
  }
  return Math.max(0, Number((grandTotal - applied).toFixed(2)));
};

const unlinkedManualReturnFilter = () => ({
  ...MANUAL_RETURN_BASE_FILTER,
  $expr: {
    $lt: [
      { $ifNull: ["$appliedCreditAmount", 0] },
      { $subtract: ["$grandTotal", 0.009] },
    ],
  },
});

const recalcSalesInvoicePaymentStatus = (invoice) => {
  const effectiveTotal = Math.max(
    0,
    Number(invoice.grandTotal || 0) - Number(invoice.returnedAmount || 0)
  );
  const paid = Number(invoice.paidAmount || 0);
  invoice.balanceAmount = Math.max(0, Number((effectiveTotal - paid).toFixed(2)));

  invoice.paymentStatus = computePaymentStatus(invoice);
};

const normalizeRef = (value) => {
  const trimmed = String(value ?? "").trim();
  if (!trimmed || trimmed.toUpperCase() === "MANUAL") return "";
  return trimmed.toLowerCase();
};

const uniqueRefs = (values) => [...new Set(values.map(normalizeRef).filter(Boolean))];

const customerQuery = (customerId) => {
  const id = String(customerId ?? "");
  if (!id) return {};
  if (!mongoose.isValidObjectId(id)) return { customerId: id };
  const oid = new mongoose.Types.ObjectId(id);
  return { $or: [{ customerId: id }, { customerId: oid }] };
};

const absorbRoomOnInvoice = (invoice) =>
  Math.max(
    0,
    Number(
      (Number(invoice?.grandTotal || 0) - Number(invoice?.returnedAmount || 0)).toFixed(2)
    )
  );

const manualReturnMatchesInvoice = (manualReturn, invoice) => {
  if (String(manualReturn.customerId) !== String(invoice.customerId)) return false;

  const invoiceTokens = uniqueRefs([invoice?.invoiceNo]);
  const returnTokens = uniqueRefs([
    manualReturn?.referenceInvoiceNo,
    manualReturn?.originalInvoiceNo,
  ]);
  if (!invoiceTokens.length || !returnTokens.length) return false;

  return returnTokens.some((token) => invoiceTokens.includes(token));
};

export const findSalesInvoiceForManualReturn = async ({
  companyId,
  financialYearId,
  customerId,
  referenceInvoiceNo,
  warehouseId,
  salesType,
}) => {
  const tokens = uniqueRefs([referenceInvoiceNo]);
  if (!tokens.length) return null;

  const matches = await SalesInvoice.find({
    companyId,
    financialYearId,
    ...customerQuery(customerId),
    isActive: true,
    status: "confirmed",
    $or: tokens.map((token) => ({
      invoiceNo: { $regex: new RegExp(`^${escapeRegex(token)}$`, "i") },
    })),
  })
    .sort({ invoiceDate: 1, createdAt: 1 })
    .lean();

  if (!matches.length) return null;
  if (matches.length === 1) return matches[0];

  if (warehouseId) {
    const wh = matches.find((row) => String(row.warehouseId) === String(warehouseId));
    if (wh) return wh;
  }

  if (salesType) {
    const st = matches.find((row) => String(row.salesType) === String(salesType));
    if (st) return st;
  }

  return matches[0];
};

export async function applyManualReturnToInvoice(invoice, salesReturn, session) {
  const remaining = remainingManualReturnCredit(salesReturn);
  if (remaining <= 0.009) return false;

  const room = absorbRoomOnInvoice(invoice);
  const balanceDue = computeInvoiceBalance(invoice);
  const applyAmount = Number(
    Math.min(remaining, room, balanceDue).toFixed(2)
  );
  if (applyAmount <= 0.009) return false;

  const previousReturnedAmount = Number(invoice.returnedAmount || 0);
  const maxReturn = Number(invoice.grandTotal || 0);
  const nextReturned = Number(
    Math.min(maxReturn, previousReturnedAmount + applyAmount).toFixed(2)
  );
  const actualApplied = Number((nextReturned - previousReturnedAmount).toFixed(2));
  if (actualApplied <= 0.009) return false;

  invoice.returnedAmount = nextReturned;
  recalcSalesInvoicePaymentStatus(invoice);
  await invoice.save(sessionOpts(session));

  const returnUpdate = {
    $inc: { appliedCreditAmount: actualApplied },
  };
  const newApplied = Number(
    (Number(salesReturn.appliedCreditAmount || 0) + actualApplied).toFixed(2)
  );
  if (newApplied + 0.009 >= Number(salesReturn.grandTotal || 0)) {
    returnUpdate.$set = { salesInvoiceId: invoice._id };
  } else if (!salesReturn.salesInvoiceId) {
    returnUpdate.$set = { salesInvoiceId: invoice._id };
  }

  await SalesReturn.updateOne({ _id: salesReturn._id }, returnUpdate, sessionOpts(session));
  salesReturn.appliedCreditAmount = newApplied;
  if (returnUpdate.$set?.salesInvoiceId) {
    salesReturn.salesInvoiceId = returnUpdate.$set.salesInvoiceId;
  }

  return true;
}

/** Sum of manual return credit not yet applied to invoice balances (receipt shop balance). */
export async function getUnappliedManualSalesReturnCredit(
  companyId,
  financialYearId,
  customerId
) {
  if (!companyId || !financialYearId || !customerId) return 0;

  const returns = await SalesReturn.find({
    ...MANUAL_RETURN_BASE_FILTER,
    companyId,
    financialYearId,
    ...customerQuery(customerId),
  })
    .select("grandTotal appliedCreditAmount salesInvoiceId")
    .lean();

  return Number(
    returns
      .reduce((sum, row) => sum + remainingManualReturnCredit(row), 0)
      .toFixed(2)
  );
}

const MANUAL_RETURN_SELECT =
  "grandTotal referenceInvoiceNo originalInvoiceNo customerId warehouseId salesType returnDate createdAt";

const sortInvoicesForManualReturn = (manualReturn, invoices) => {
  const whId = String(manualReturn.warehouseId ?? "");
  const salesType = manualReturn.salesType ? String(manualReturn.salesType) : "";

  return [...invoices].sort((a, b) => {
    const aWh = Boolean(whId && String(a.warehouseId) === whId);
    const bWh = Boolean(whId && String(b.warehouseId) === whId);
    if (aWh !== bWh) return aWh ? -1 : 1;
    const aSt = Boolean(salesType && String(a.salesType) === salesType);
    const bSt = Boolean(salesType && String(b.salesType) === salesType);
    if (aSt !== bSt) return aSt ? -1 : 1;
    return 0;
  });
};

async function spreadManualReturnAcrossInvoices(manualReturn, invoices) {
  let returnDoc = await SalesReturn.findById(manualReturn._id);
  if (!returnDoc || remainingManualReturnCredit(returnDoc) <= 0.009) return;

  const ordered = sortInvoicesForManualReturn(manualReturn, invoices);

  for (const inv of ordered) {
    returnDoc = await SalesReturn.findById(manualReturn._id);
    if (!returnDoc || remainingManualReturnCredit(returnDoc) <= 0.009) break;

    const invoiceDoc = await SalesInvoice.findById(inv._id);
    if (!invoiceDoc) continue;

    const applied = await applyManualReturnToInvoice(invoiceDoc, returnDoc);
    if (applied) {
      inv.returnedAmount = invoiceDoc.returnedAmount;
    }
  }
}

/** Apply manual returns with remaining credit to receivable invoices (FIFO, partial OK). */
async function applyFifoUnlinkedManualReturnsForCustomer(
  companyId,
  financialYearId,
  customerId
) {
  const unlinked = await SalesReturn.find({
    ...unlinkedManualReturnFilter(),
    companyId,
    financialYearId,
    ...customerQuery(customerId),
  })
    .select(MANUAL_RETURN_SELECT)
    .sort({ returnDate: 1, createdAt: 1 });

  if (!unlinked.length) return;

  const invoices = await SalesInvoice.find({
    companyId,
    financialYearId,
    ...customerQuery(customerId),
    isActive: true,
    status: "confirmed",
  }).sort({ invoiceDate: 1, createdAt: 1, _id: 1 });

  if (!invoices.length) return;

  for (const manualReturn of unlinked) {
    await spreadManualReturnAcrossInvoices(manualReturn, invoices);
  }
}

export async function persistUnlinkedManualReturnsForInvoice(
  companyId,
  financialYearId,
  invoiceId
) {
  const safeInvoiceId = optionalObjectId(invoiceId, "invoice id");
  if (!companyId || !financialYearId || !safeInvoiceId) return;

  let invoice = await SalesInvoice.findOne({
    _id: safeInvoiceId,
    companyId,
    financialYearId,
    isActive: true,
    status: "confirmed",
  });
  if (!invoice) return;

  const manualReturns = await SalesReturn.find({
    ...unlinkedManualReturnFilter(),
    companyId,
    financialYearId,
    ...customerQuery(invoice.customerId),
  }).select(MANUAL_RETURN_SELECT);

  const matched = manualReturns.filter((row) =>
    manualReturnMatchesInvoice(row, invoice)
  );
  const rest = manualReturns.filter((row) => !manualReturnMatchesInvoice(row, invoice));

  for (const manualReturn of matched) {
    await spreadManualReturnAcrossInvoices(manualReturn, [invoice]);
    invoice = await SalesInvoice.findById(invoice._id);
    if (!invoice) return;
  }

  const invoices = await SalesInvoice.find({
    companyId,
    financialYearId,
    ...customerQuery(invoice.customerId),
    isActive: true,
    status: "confirmed",
  }).sort({ invoiceDate: 1, createdAt: 1, _id: 1 });

  for (const manualReturn of rest) {
    await spreadManualReturnAcrossInvoices(manualReturn, invoices);
  }
}

export async function persistUnlinkedManualReturnsForCustomer(
  companyId,
  financialYearId,
  customerId
) {
  if (!companyId || !financialYearId || !customerId) return;

  const manualReturns = await SalesReturn.find({
    ...unlinkedManualReturnFilter(),
    companyId,
    financialYearId,
    ...customerQuery(customerId),
  })
    .select(MANUAL_RETURN_SELECT)
    .lean();

  if (!manualReturns.length) return;

  const invoices = await SalesInvoice.find({
    companyId,
    financialYearId,
    ...customerQuery(customerId),
    isActive: true,
    status: "confirmed",
  }).sort({ invoiceDate: 1, createdAt: 1, _id: 1 });

  if (!invoices.length) return;

  for (const manualReturn of manualReturns) {
    const matches = invoices.filter((row) => manualReturnMatchesInvoice(manualReturn, row));
    if (matches.length) {
      let invoice = matches[0];
      if (matches.length > 1) {
        if (manualReturn.warehouseId) {
          const wh = matches.find(
            (row) => String(row.warehouseId) === String(manualReturn.warehouseId)
          );
          if (wh) invoice = wh;
        }
        if (manualReturn.salesType) {
          const st = matches.find(
            (row) => String(row.salesType) === String(manualReturn.salesType)
          );
          if (st) invoice = st;
        }
      }
      await spreadManualReturnAcrossInvoices(manualReturn, [invoice]);
    }
  }

  await applyFifoUnlinkedManualReturnsForCustomer(companyId, financialYearId, customerId);
}
