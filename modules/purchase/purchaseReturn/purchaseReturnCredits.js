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
}) => {
  const tokens = uniqueRefs([referenceInvoiceNo, vendorInvoiceNo]);
  if (!tokens.length) return null;

  return PurchaseInvoice.findOne({
    companyId,
    financialYearId,
    vendorId,
    isActive: true,
    status: "confirmed",
    $or: tokens.flatMap((token) => [
      { invoiceNo: { $regex: new RegExp(`^${escapeRegex(token)}$`, "i") } },
      { vendorInvoiceNo: { $regex: new RegExp(`^${escapeRegex(token)}$`, "i") } },
    ]),
  });
};

export async function applyManualReturnToInvoice(invoice, purchaseReturn, session) {
  const claimed = await claimManualReturn(purchaseReturn._id, invoice._id, session);
  if (!claimed) return false;

  const previousReturnedAmount = Number(invoice.returnedAmount || 0);

  try {
    invoice.returnedAmount = Number(
      (previousReturnedAmount + Number(purchaseReturn.grandTotal || 0)).toFixed(2)
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
  "grandTotal referenceInvoiceNo vendorInvoiceNo originalInvoiceNo vendorId";

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
    vendorId: invoice.vendorId,
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
    vendorId,
  })
    .select(MANUAL_RETURN_SELECT)
    .lean();

  if (!manualReturns.length) return;

  const invoices = await PurchaseInvoice.find({
    companyId,
    financialYearId,
    vendorId,
    isActive: true,
    status: "confirmed",
  });

  if (!invoices.length) return;

  for (const manualReturn of manualReturns) {
    const invoice = invoices.find((row) => manualReturnMatchesInvoice(manualReturn, row));
    if (!invoice) continue;
    await applyManualReturnToInvoice(invoice, manualReturn);
  }
}
