import mongoose from "mongoose";
import SalesInvoice from "../salesInvoice/salesInvoice.model.js";
import SalesReturn from "./salesReturn.model.js";
import { sessionOpts } from "../../../utils/withTransaction.js";
import { computePaymentStatus } from "../../../utils/invoicePaymentStatus.js";
import { escapeRegex } from "../../../utils/escapeRegex.js";
import { optionalObjectId } from "../../../utils/sanitizeInput.js";

const UNLINKED_RETURN_FILTER = {
  returnMode: "manual",
  status: "confirmed",
  isActive: { $ne: false },
  salesInvoiceId: null,
};

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

/**
 * Links the return to the invoice only if no other request linked it first, so a
 * manual return can never be subtracted twice from the same invoice.
 */
const claimManualReturn = async (returnId, invoiceId, session) => {
  const result = await SalesReturn.updateOne(
    { _id: returnId, salesInvoiceId: null },
    { $set: { salesInvoiceId: invoiceId } },
    sessionOpts(session)
  );
  return result.modifiedCount === 1;
};

const releaseManualReturn = (returnId, session) =>
  SalesReturn.updateOne(
    { _id: returnId },
    { $set: { salesInvoiceId: null } },
    sessionOpts(session)
  );

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
  const credit = Number(salesReturn.grandTotal || 0);
  if (credit <= 0) return false;

  const room = absorbRoomOnInvoice(invoice);
  if (room + 0.009 < credit) return false;

  const claimed = await claimManualReturn(salesReturn._id, invoice._id, session);
  if (!claimed) return false;

  const previousReturnedAmount = Number(invoice.returnedAmount || 0);

  try {
    const maxReturn = Number(invoice.grandTotal || 0);
    invoice.returnedAmount = Number(
      Math.min(maxReturn, previousReturnedAmount + credit).toFixed(2)
    );
    recalcSalesInvoicePaymentStatus(invoice);
    await invoice.save(sessionOpts(session));
    return true;
  } catch (err) {
    invoice.returnedAmount = previousReturnedAmount;
    recalcSalesInvoicePaymentStatus(invoice);
    await releaseManualReturn(salesReturn._id, session);
    throw err;
  }
}

const MANUAL_RETURN_SELECT =
  "grandTotal referenceInvoiceNo originalInvoiceNo customerId warehouseId salesType returnDate createdAt";

const pickInvoiceForFifoManualReturn = (manualReturn, invoices) => {
  const returnAmount = Number(manualReturn.grandTotal || 0);
  if (returnAmount <= 0) return null;

  const whId = String(manualReturn.warehouseId ?? "");
  const salesType = manualReturn.salesType ? String(manualReturn.salesType) : "";

  const eligible = invoices
    .map((inv) => ({
      inv,
      room: absorbRoomOnInvoice(inv),
      whMatch: Boolean(whId && String(inv.warehouseId) === whId),
      salesTypeMatch: Boolean(salesType && String(inv.salesType) === salesType),
    }))
    .filter(({ room }) => room + 0.009 >= returnAmount);

  if (!eligible.length) return null;

  eligible.sort((a, b) => {
    if (a.whMatch !== b.whMatch) return a.whMatch ? -1 : 1;
    if (a.salesTypeMatch !== b.salesTypeMatch) return a.salesTypeMatch ? -1 : 1;
    return 0;
  });

  return eligible[0].inv;
};

/** Apply manual returns with no invoice link yet to oldest receivable invoice (same shop preferred). */
async function applyFifoUnlinkedManualReturnsForCustomer(
  companyId,
  financialYearId,
  customerId
) {
  const unlinked = await SalesReturn.find({
    ...UNLINKED_RETURN_FILTER,
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
    const stillOpen = await SalesReturn.findOne({
      _id: manualReturn._id,
      salesInvoiceId: null,
    }).select("_id");
    if (!stillOpen) continue;

    const invoice = pickInvoiceForFifoManualReturn(manualReturn, invoices);
    if (!invoice) continue;

    const invoiceDoc = await SalesInvoice.findById(invoice._id);
    if (!invoiceDoc) continue;

    const applied = await applyManualReturnToInvoice(invoiceDoc, manualReturn);
    if (applied) {
      const idx = invoices.findIndex((row) => String(row._id) === String(invoice._id));
      if (idx >= 0) {
        invoices[idx].returnedAmount = invoiceDoc.returnedAmount;
      }
    }
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
    ...UNLINKED_RETURN_FILTER,
    companyId,
    financialYearId,
    ...customerQuery(invoice.customerId),
  }).select(MANUAL_RETURN_SELECT);

  for (const manualReturn of manualReturns) {
    if (!manualReturnMatchesInvoice(manualReturn, invoice)) continue;
    const applied = await applyManualReturnToInvoice(invoice, manualReturn);
    if (applied) {
      invoice = await SalesInvoice.findById(invoice._id);
      if (!invoice) break;
    }
  }
}

export async function persistUnlinkedManualReturnsForCustomer(
  companyId,
  financialYearId,
  customerId
) {
  if (!companyId || !financialYearId || !customerId) return;

  const manualReturns = await SalesReturn.find({
    ...UNLINKED_RETURN_FILTER,
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
    if (!matches.length) continue;

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

    const invoiceDoc = await SalesInvoice.findById(invoice._id);
    if (!invoiceDoc) continue;

    const applied = await applyManualReturnToInvoice(invoiceDoc, manualReturn);
    if (applied) {
      const idx = invoices.findIndex((row) => String(row._id) === String(invoice._id));
      if (idx >= 0) invoices[idx].returnedAmount = invoiceDoc.returnedAmount;
    }
  }

  await applyFifoUnlinkedManualReturnsForCustomer(companyId, financialYearId, customerId);
}
