// ── 4. SHOP REPORT (Customer Ledger) ─────────────────────────
// Shows all debits (invoices) and credits (payments) for a customer

import ApiError from "../../../utils/ApiError.js";
import ApiResponse from "../../../utils/ApiResponse.js";
import asyncHandler from "../../../utils/asyncHandler.js";
import ReceiptPayment from "../../receipt-payment/receiptPayment.model.js";
import salesInvoiceModel from "../../sales/salesInvoice/salesInvoice.model.js";

// With running balance — like a bank statement
export const shopReport = asyncHandler(async (req, res) => {
  const { customerId, dateFrom, dateTo } = req.query;

  if (!customerId) throw new ApiError(400, "customerId is required");

  const dateFilter = {};
  if (dateFrom) dateFilter.$gte = new Date(dateFrom);
  if (dateTo)   { const e = new Date(dateTo); e.setHours(23,59,59,999); dateFilter.$lte = e; }

  const baseFilter = {
    companyId:       req.companyId,
    financialYearId: req.fyId,
    customerId,
    isActive: true,
  };

  // Get all sales invoices for customer
  const invoiceFilter = { ...baseFilter };
  if (Object.keys(dateFilter).length) invoiceFilter.invoiceDate = dateFilter;

  const invoices = await salesInvoiceModel.find(invoiceFilter)
    .select("invoiceNo invoiceDate grandTotal paidAmount balanceAmount paymentStatus salesType")
    .sort({ invoiceDate: 1 })
    .lean();

  // Get all receipts for customer
  const receiptFilter = {
    companyId:       req.companyId,
    financialYearId: req.fyId,
    partyId:         customerId,
    voucherType:     "receipt",
    status:          { $ne: "cancelled" },
    isActive:        true,
  };
  if (Object.keys(dateFilter).length) receiptFilter.date = dateFilter;

  const payments = await ReceiptPayment.find(receiptFilter)
    .select("voucherNo date totalAmount paymentMode referenceNo")
    .sort({ date: 1 })
    .lean();

  // Merge invoices (debit) and payments (credit) → sort by date
  const entries = [
    ...invoices.map(inv => ({
      date:       inv.invoiceDate,
      type:       "invoice",
      refNo:      inv.invoiceNo,
      salesType:  inv.salesType,
      debit:      inv.grandTotal,   // customer owes
      credit:     0,
      balance:    0,                // calculated below
      status:     inv.paymentStatus,
      _id:        inv._id,
    })),
    ...payments.map(pay => ({
      date:       pay.date,
      type:       "payment",
      refNo:      pay.voucherNo,
      salesType:  "",
      debit:      0,
      credit:     pay.totalAmount,   // customer paid
      balance:    0,
      paymentMode:pay.paymentMode,
      referenceNo:pay.referenceNo,
      _id:        pay._id,
    })),
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Calculate running balance
  let runningBalance = 0;
  entries.forEach(entry => {
    runningBalance = Number((runningBalance + entry.debit - entry.credit).toFixed(2));
    entry.balance  = runningBalance;
  });

  // Summary
  const totalDebit  = Number(entries.reduce((s, e) => s + e.debit,  0).toFixed(2));
  const totalCredit = Number(entries.reduce((s, e) => s + e.credit, 0).toFixed(2));
  const outstanding = Number((totalDebit - totalCredit).toFixed(2));

  res.json(new ApiResponse(200, {
    data: entries,
    summary: { totalDebit, totalCredit, outstanding },
  }));
});