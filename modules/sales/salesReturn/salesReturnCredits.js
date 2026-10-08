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
}) => {
  const tokens = uniqueRefs([referenceInvoiceNo]);
  if (!tokens.length) return null;

  return SalesInvoice.findOne({
    companyId,
    financialYearId,
    customerId,
    isActive: true,
    status: "confirmed",
    $or: tokens.map((token) => ({
      invoiceNo: { $regex: new RegExp(`^${escapeRegex(token)}$`, "i") },
    })),
  });
};

const MANUAL_RETURN_SELECT =
  "grandTotal referenceInvoiceNo originalInvoiceNo customerId";

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
    customerId: invoice.customerId,
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

export async function applyManualReturnToInvoice(invoice, salesReturn, session) {
  const claimed = await claimManualReturn(salesReturn._id, invoice._id, session);
  if (!claimed) return false;

  const previousReturnedAmount = Number(invoice.returnedAmount || 0);

  try {
    invoice.returnedAmount = Number(
      (previousReturnedAmount + Number(salesReturn.grandTotal || 0)).toFixed(2)
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
    customerId,
  })
    .select(MANUAL_RETURN_SELECT)
    .lean();

  if (!manualReturns.length) return;

  const invoices = await SalesInvoice.find({
    companyId,
    financialYearId,
    customerId,
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
