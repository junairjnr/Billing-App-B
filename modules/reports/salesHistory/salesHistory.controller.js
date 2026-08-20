// ── 6. SALES HISTORY — Item wise ──────────────────────────────

import ApiError from "../../../utils/ApiError.js";
import ApiResponse from "../../../utils/ApiResponse.js";
import asyncHandler from "../../../utils/asyncHandler.js";
import salesInvoiceModel from "../../sales/salesInvoice/salesInvoice.model.js";

// Shows all sales invoices where this item appeared
export const salesHistory = asyncHandler(async (req, res) => {
  const { itemId, customerId, salesType, dateFrom, dateTo, page = 1, limit = 50 } = req.query;

  if (!itemId) throw new ApiError(400, "itemId is required");

  const filter = {
    companyId:       req.companyId,
    financialYearId: req.fyId,
    "items.itemId":  itemId,
    isActive:        true,
  };

  if (customerId) filter.customerId = customerId;
  if (salesType)  filter.salesType  = salesType;
  if (dateFrom || dateTo) {
    filter.invoiceDate = {};
    if (dateFrom) filter.invoiceDate.$gte = new Date(dateFrom);
    if (dateTo)   { const e = new Date(dateTo); e.setHours(23,59,59,999); filter.invoiceDate.$lte = e; }
  }

  const skip = (Number(page) - 1) * Number(limit);

  const invoices = await salesInvoiceModel.find(filter)
    .populate("customerId",   "name phone")
    .populate("warehouseId",  "name code")
    .populate("priceLevelId", "name taxPercent")
    .select("invoiceNo invoiceDate salesType customerId customerSnapshot warehouseId priceLevelSnapshot items grandTotal status")
    .sort({ invoiceDate: -1 })
    .skip(skip)
    .limit(Number(limit))
    .lean();

  const total = await salesInvoiceModel.countDocuments(filter);

  // Extract only the matching item row from each invoice
  const rows = invoices.map(inv => {
    const itemRow = inv.items.find(i => i.itemId?.toString() === itemId);
    return {
      _id:            inv._id,
      invoiceNo:      inv.invoiceNo,
      invoiceId:      inv._id,
      invoiceDate:    inv.invoiceDate,
      salesType:      inv.salesType,
      customer:       typeof inv.customerId === "object" ? inv.customerId : inv.customerSnapshot,
      priceLevel:     inv.priceLevelSnapshot,
      warehouse:      inv.warehouseId,
      hsn:            itemRow?.hsn          || "",
      baseRate:       itemRow?.baseRate     || 0,
      priceLevelPct:  itemRow?.priceLevelPct|| 0,
      rate:           itemRow?.rate         || 0,
      qty:            itemRow?.qty          || 0,
      discount:       itemRow?.discount     || 0,
      discountAmt:    itemRow?.discountAmt  || 0,
      taxableValue:   itemRow?.taxableValue || 0,
      sgst:           itemRow?.sgst         || 0,
      cgst:           itemRow?.cgst         || 0,
      total:          itemRow?.total        || 0,
    };
  });

  // Summary
  const allInvoices = await salesInvoiceModel.find(filter).select("items salesType").lean();
  const allRows     = allInvoices.flatMap(inv => inv.items.filter(i => i.itemId?.toString() === itemId));

  const summary = {
    totalBills:    total,
    retailBills:   allInvoices.filter(i => i.salesType === "retail").length,
    wholesaleBills:allInvoices.filter(i => i.salesType === "wholesale").length,
    totalQty:      Number(allRows.reduce((s, r) => s + r.qty,          0).toFixed(2)),
    totalValue:    Number(allRows.reduce((s, r) => s + r.total,        0).toFixed(2)),
    totalTaxable:  Number(allRows.reduce((s, r) => s + r.taxableValue, 0).toFixed(2)),
    totalDiscount: Number(allRows.reduce((s, r) => s + r.discountAmt,  0).toFixed(2)),
    avgRate:       allRows.length ? Number((allRows.reduce((s, r) => s + r.rate, 0) / allRows.length).toFixed(2)) : 0,
    minRate:       allRows.length ? Math.min(...allRows.map(r => r.rate)) : 0,
    maxRate:       allRows.length ? Math.max(...allRows.map(r => r.rate)) : 0,
  };

  res.json(new ApiResponse(200, {
    rows,
    total,
    page:       Number(page),
    totalPages: Math.ceil(total / Number(limit)),
    hasNext:    Number(page) < Math.ceil(total / Number(limit)),
    summary,
  }));
});

