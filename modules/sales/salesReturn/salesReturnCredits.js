import SalesInvoice from "../salesInvoice/salesInvoice.model.js";
import SalesReturn from "./salesReturn.model.js";
import { sessionOpts } from "../../../utils/withTransaction.js";

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
    invoiceNo: { $in: tokens },
  });
};

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
    .select("grandTotal referenceInvoiceNo originalInvoiceNo customerId")
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
