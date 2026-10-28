import mongoose from "mongoose";
import PurchaseInvoice from "../purchaseInvoice/purchaseInvoice.model.js";
import PurchaseReturn from "./purchaseReturn.model.js";
import { sessionOpts } from "../../../utils/withTransaction.js";
import { escapeRegex } from "../../../utils/escapeRegex.js";
import { optionalObjectId } from "../../../utils/sanitizeInput.js";
import {
  computeInvoiceBalance,
  computePaymentStatus,
} from "../../../utils/invoicePaymentStatus.js";

const MANUAL_RETURN_BASE_FILTER = {
  returnMode: "manual",
  status: "confirmed",
  isActive: { $ne: false },
};

export const remainingManualReturnCredit = (purchaseReturn) => {
  const grandTotal = Number(purchaseReturn?.grandTotal || 0);
  if (grandTotal <= 0) return 0;
  let applied = Number(purchaseReturn?.appliedCreditAmount || 0);
  if (applied <= 0 && purchaseReturn?.purchaseInvoiceId) {
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

const recalcPurchaseInvoicePaymentStatus = (invoice) => {
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

const vendorQuery = (vendorId) => {
  const id = String(vendorId ?? "");
  if (!id) return {};
  if (!mongoose.isValidObjectId(id)) return { vendorId: id };
  const oid = new mongoose.Types.ObjectId(id);
  return { $or: [{ vendorId: id }, { vendorId: oid }] };
};

const absorbRoomOnInvoice = (invoice) =>
  Math.max(
    0,
    Number(
      (Number(invoice?.grandTotal || 0) - Number(invoice?.returnedAmount || 0)).toFixed(2)
    )
  );

const manualReturnMatchesInvoice = (manualReturn, invoice) => {
  if (String(manualReturn.vendorId) !== String(invoice.vendorId)) return false;

  const invoiceTokens = uniqueRefs([invoice?.invoiceNo, invoice?.vendorInvoiceNo]);
  const returnTokens = uniqueRefs([
    manualReturn?.referenceInvoiceNo,
    manualReturn?.vendorInvoiceNo,
    manualReturn?.originalInvoiceNo,
  ]);
  if (!invoiceTokens.length || !returnTokens.length) return false;

  return returnTokens.some((token) => invoiceTokens.includes(token));
};

export const findPurchaseInvoiceForManualReturn = async ({
  companyId,
  financialYearId,
  vendorId,
  referenceInvoiceNo,
  vendorInvoiceNo,
  warehouseId,
}) => {
  const tokens = uniqueRefs([referenceInvoiceNo, vendorInvoiceNo]);
  if (!tokens.length) return null;

  const matches = await PurchaseInvoice.find({
    companyId,
    financialYearId,
    ...vendorQuery(vendorId),
    isActive: true,
    status: "confirmed",
    $or: tokens.flatMap((token) => [
      { invoiceNo: { $regex: new RegExp(`^${escapeRegex(token)}$`, "i") } },
      { vendorInvoiceNo: { $regex: new RegExp(`^${escapeRegex(token)}$`, "i") } },
    ]),
  })
    .sort({ purchaseDate: 1, createdAt: 1 })
    .lean();

  if (!matches.length) return null;
  if (matches.length === 1) return matches[0];

  if (warehouseId) {
    const wh = matches.find((row) => String(row.warehouseId) === String(warehouseId));
    if (wh) return wh;
  }

  return matches[0];
};

export async function applyManualReturnToInvoice(invoice, purchaseReturn, session) {
  const remaining = remainingManualReturnCredit(purchaseReturn);
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
  recalcPurchaseInvoicePaymentStatus(invoice);
  await invoice.save(sessionOpts(session));

  const returnUpdate = {
    $inc: { appliedCreditAmount: actualApplied },
  };
  const newApplied = Number(
    (Number(purchaseReturn.appliedCreditAmount || 0) + actualApplied).toFixed(2)
  );
  if (newApplied + 0.009 >= Number(purchaseReturn.grandTotal || 0)) {
    returnUpdate.$set = { purchaseInvoiceId: invoice._id };
  } else if (!purchaseReturn.purchaseInvoiceId) {
    returnUpdate.$set = { purchaseInvoiceId: invoice._id };
  }

  await PurchaseReturn.updateOne(
    { _id: purchaseReturn._id },
    returnUpdate,
    sessionOpts(session)
  );
  purchaseReturn.appliedCreditAmount = newApplied;
  if (returnUpdate.$set?.purchaseInvoiceId) {
    purchaseReturn.purchaseInvoiceId = returnUpdate.$set.purchaseInvoiceId;
  }

  return true;
}

/** Sum of manual return credit not yet applied to invoice balances (payment voucher shop balance). */
export async function getUnappliedManualPurchaseReturnCredit(
  companyId,
  financialYearId,
  vendorId
) {
  if (!companyId || !financialYearId || !vendorId) return 0;

  const returns = await PurchaseReturn.find({
    ...MANUAL_RETURN_BASE_FILTER,
    companyId,
    financialYearId,
    ...vendorQuery(vendorId),
  })
    .select("grandTotal appliedCreditAmount purchaseInvoiceId")
    .lean();

  return Number(
    returns
      .reduce((sum, row) => sum + remainingManualReturnCredit(row), 0)
      .toFixed(2)
  );
}

const MANUAL_RETURN_SELECT =
  "grandTotal referenceInvoiceNo vendorInvoiceNo originalInvoiceNo vendorId warehouseId returnDate createdAt";

const sortInvoicesForManualReturn = (manualReturn, invoices) => {
  const whId = String(manualReturn.warehouseId ?? "");

  return [...invoices].sort((a, b) => {
    const aWh = Boolean(whId && String(a.warehouseId) === whId);
    const bWh = Boolean(whId && String(b.warehouseId) === whId);
    if (aWh !== bWh) return aWh ? -1 : 1;
    return 0;
  });
};

async function spreadManualReturnAcrossInvoices(manualReturn, invoices) {
  let returnDoc = await PurchaseReturn.findById(manualReturn._id);
  if (!returnDoc || remainingManualReturnCredit(returnDoc) <= 0.009) return;

  const ordered = sortInvoicesForManualReturn(manualReturn, invoices);

  for (const inv of ordered) {
    returnDoc = await PurchaseReturn.findById(manualReturn._id);
    if (!returnDoc || remainingManualReturnCredit(returnDoc) <= 0.009) break;

    const invoiceDoc = await PurchaseInvoice.findById(inv._id);
    if (!invoiceDoc) continue;

    const applied = await applyManualReturnToInvoice(invoiceDoc, returnDoc);
    if (applied) {
      inv.returnedAmount = invoiceDoc.returnedAmount;
    }
  }
}

/** Apply manual returns with remaining credit to payable invoices (FIFO, partial OK). */
async function applyFifoUnlinkedManualReturnsForVendor(
  companyId,
  financialYearId,
  vendorId
) {
  const unlinked = await PurchaseReturn.find({
    ...unlinkedManualReturnFilter(),
    companyId,
    financialYearId,
    ...vendorQuery(vendorId),
  })
    .select(MANUAL_RETURN_SELECT)
    .sort({ returnDate: 1, createdAt: 1 });

  if (!unlinked.length) return;

  const invoices = await PurchaseInvoice.find({
    companyId,
    financialYearId,
    ...vendorQuery(vendorId),
    isActive: true,
    status: "confirmed",
  }).sort({ purchaseDate: 1, createdAt: 1, _id: 1 });

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

  let invoice = await PurchaseInvoice.findOne({
    _id: safeInvoiceId,
    companyId,
    financialYearId,
    isActive: true,
    status: "confirmed",
  });
  if (!invoice) return;

  const manualReturns = await PurchaseReturn.find({
    ...unlinkedManualReturnFilter(),
    companyId,
    financialYearId,
    ...vendorQuery(invoice.vendorId),
  }).select(MANUAL_RETURN_SELECT);

  const matched = manualReturns.filter((row) =>
    manualReturnMatchesInvoice(row, invoice)
  );
  const rest = manualReturns.filter((row) => !manualReturnMatchesInvoice(row, invoice));

  for (const manualReturn of matched) {
    await spreadManualReturnAcrossInvoices(manualReturn, [invoice]);
    invoice = await PurchaseInvoice.findById(invoice._id);
    if (!invoice) return;
  }

  const invoices = await PurchaseInvoice.find({
    companyId,
    financialYearId,
    ...vendorQuery(invoice.vendorId),
    isActive: true,
    status: "confirmed",
  }).sort({ purchaseDate: 1, createdAt: 1, _id: 1 });

  for (const manualReturn of rest) {
    await spreadManualReturnAcrossInvoices(manualReturn, invoices);
  }
}

export async function persistUnlinkedManualReturnsForVendor(
  companyId,
  financialYearId,
  vendorId
) {
  if (!companyId || !financialYearId || !vendorId) return;

  const manualReturns = await PurchaseReturn.find({
    ...unlinkedManualReturnFilter(),
    companyId,
    financialYearId,
    ...vendorQuery(vendorId),
  })
    .select(MANUAL_RETURN_SELECT)
    .lean();

  if (!manualReturns.length) return;

  const invoices = await PurchaseInvoice.find({
    companyId,
    financialYearId,
    ...vendorQuery(vendorId),
    isActive: true,
    status: "confirmed",
  }).sort({ purchaseDate: 1, createdAt: 1, _id: 1 });

  if (!invoices.length) return;

  for (const manualReturn of manualReturns) {
    const matches = invoices.filter((row) => manualReturnMatchesInvoice(manualReturn, row));
    if (matches.length) {
      let invoice = matches[0];
      if (matches.length > 1 && manualReturn.warehouseId) {
        const wh = matches.find(
          (row) => String(row.warehouseId) === String(manualReturn.warehouseId)
        );
        if (wh) invoice = wh;
      }
      await spreadManualReturnAcrossInvoices(manualReturn, [invoice]);
    }
  }

  await applyFifoUnlinkedManualReturnsForVendor(companyId, financialYearId, vendorId);
}
