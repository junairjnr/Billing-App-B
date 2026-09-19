import PurchaseInvoice from "../purchaseInvoice/purchaseInvoice.model.js";
import PurchaseReturn from "./purchaseReturn.model.js";
import { sessionOpts } from "../../../utils/withTransaction.js";

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

  if (paid <= 0) invoice.paymentStatus = "pending";
  else if (paid >= effectiveTotal - 0.009) invoice.paymentStatus = "paid";
  else invoice.paymentStatus = "partial";
};

const normalizeRef = (value) => {
  const trimmed = String(value ?? "").trim();
  if (!trimmed || trimmed.toUpperCase() === "MANUAL") return "";
  return trimmed;
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
    $or: tokens.flatMap((token) => [{ invoiceNo: token }, { vendorInvoiceNo: token }]),
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
    .select("grandTotal referenceInvoiceNo vendorInvoiceNo originalInvoiceNo vendorId")
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
