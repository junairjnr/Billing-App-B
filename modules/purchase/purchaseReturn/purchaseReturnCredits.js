import mongoose from "mongoose";
import PurchaseInvoice from "../purchaseInvoice/purchaseInvoice.model.js";
import PurchaseReturn from "./purchaseReturn.model.js";
import { sessionOpts } from "../../../utils/withTransaction.js";
import { escapeRegex } from "../../../utils/escapeRegex.js";
import { optionalObjectId } from "../../../utils/sanitizeInput.js";
import { computePaymentStatus } from "../../../utils/invoicePaymentStatus.js";

const UNLINKED_RETURN_FILTER = {
  returnMode: "manual",
  status: "confirmed",
  isActive: { $ne: false },
  purchaseInvoiceId: null,
};

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

/**
 * Links the return to the invoice only if no other request linked it first, so a
 * manual return can never be subtracted twice from the same invoice.
 */
const claimManualReturn = async (returnId, invoiceId, session) => {
  const result = await PurchaseReturn.updateOne(
    { _id: returnId, purchaseInvoiceId: null },
    { $set: { purchaseInvoiceId: invoiceId } },
    sessionOpts(session)
  );
  return result.modifiedCount === 1;
};

const releaseManualReturn = (returnId, session) =>
  PurchaseReturn.updateOne(
    { _id: returnId },
    { $set: { purchaseInvoiceId: null } },
    sessionOpts(session)
  );

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
  const credit = Number(purchaseReturn.grandTotal || 0);
  if (credit <= 0) return false;

  const room = absorbRoomOnInvoice(invoice);
  if (room + 0.009 < credit) return false;

  const claimed = await claimManualReturn(purchaseReturn._id, invoice._id, session);
  if (!claimed) return false;

  const previousReturnedAmount = Number(invoice.returnedAmount || 0);

  try {
    const maxReturn = Number(invoice.grandTotal || 0);
    invoice.returnedAmount = Number(
      Math.min(maxReturn, previousReturnedAmount + credit).toFixed(2)
    );
    recalcPurchaseInvoicePaymentStatus(invoice);
    await invoice.save(sessionOpts(session));
    return true;
  } catch (err) {
    invoice.returnedAmount = previousReturnedAmount;
    recalcPurchaseInvoicePaymentStatus(invoice);
    await releaseManualReturn(purchaseReturn._id, session);
    throw err;
  }
}

const MANUAL_RETURN_SELECT =
  "grandTotal referenceInvoiceNo vendorInvoiceNo originalInvoiceNo vendorId warehouseId returnDate createdAt";

const pickInvoiceForFifoManualReturn = (manualReturn, invoices) => {
  const returnAmount = Number(manualReturn.grandTotal || 0);
  if (returnAmount <= 0) return null;

  const whId = String(manualReturn.warehouseId ?? "");
  const eligible = invoices
    .map((inv) => ({
      inv,
      room: absorbRoomOnInvoice(inv),
      whMatch: Boolean(whId && String(inv.warehouseId) === whId),
    }))
    .filter(({ room }) => room + 0.009 >= returnAmount);

  if (!eligible.length) return null;

  eligible.sort((a, b) => {
    if (a.whMatch !== b.whMatch) return a.whMatch ? -1 : 1;
    return 0;
  });

  return eligible[0].inv;
};

/** Apply manual returns with no invoice link yet to oldest payable invoice (same shop preferred). */
async function applyFifoUnlinkedManualReturnsForVendor(companyId, financialYearId, vendorId) {
  const unlinked = await PurchaseReturn.find({
    ...UNLINKED_RETURN_FILTER,
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
    const stillOpen = await PurchaseReturn.findOne({
      _id: manualReturn._id,
      purchaseInvoiceId: null,
    }).select("_id");
    if (!stillOpen) continue;

    const invoice = pickInvoiceForFifoManualReturn(manualReturn, invoices);
    if (!invoice) continue;

    const invoiceDoc = await PurchaseInvoice.findById(invoice._id);
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

  let invoice = await PurchaseInvoice.findOne({
    _id: safeInvoiceId,
    companyId,
    financialYearId,
    isActive: true,
    status: "confirmed",
  });
  if (!invoice) return;

  const manualReturns = await PurchaseReturn.find({
    ...UNLINKED_RETURN_FILTER,
    companyId,
    financialYearId,
    ...vendorQuery(invoice.vendorId),
  }).select(MANUAL_RETURN_SELECT);

  for (const manualReturn of manualReturns) {
    if (!manualReturnMatchesInvoice(manualReturn, invoice)) continue;
    const applied = await applyManualReturnToInvoice(invoice, manualReturn);
    if (applied) {
      invoice = await PurchaseInvoice.findById(invoice._id);
      if (!invoice) break;
    }
  }
}

export async function persistUnlinkedManualReturnsForVendor(
  companyId,
  financialYearId,
  vendorId
) {
  if (!companyId || !financialYearId || !vendorId) return;

  const manualReturns = await PurchaseReturn.find({
    ...UNLINKED_RETURN_FILTER,
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
    if (!matches.length) continue;

    let invoice = matches[0];
    if (matches.length > 1 && manualReturn.warehouseId) {
      const wh = matches.find(
        (row) => String(row.warehouseId) === String(manualReturn.warehouseId)
      );
      if (wh) invoice = wh;
    }

    const invoiceDoc = await PurchaseInvoice.findById(invoice._id);
    if (!invoiceDoc) continue;

    const applied = await applyManualReturnToInvoice(invoiceDoc, manualReturn);
    if (applied) {
      const idx = invoices.findIndex((row) => String(row._id) === String(invoice._id));
      if (idx >= 0) invoices[idx].returnedAmount = invoiceDoc.returnedAmount;
    }
  }

  await applyFifoUnlinkedManualReturnsForVendor(companyId, financialYearId, vendorId);
}
