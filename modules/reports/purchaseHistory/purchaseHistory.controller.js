// ── 5. PURCHASE HISTORY — Item wise ──────────────────────────

import ApiError from "../../../utils/ApiError.js";
import ApiResponse from "../../../utils/ApiResponse.js";
import asyncHandler from "../../../utils/asyncHandler.js";
import purchaseInvoiceModel from "../../purchase/purchaseInvoice/purchaseInvoice.model.js";

// Shows all purchase invoices where this item appeared
export const purchaseHistory = asyncHandler(async (req, res) => {
  const { itemId, vendorId, dateFrom, dateTo, page = 1, limit = 50 } = req.query;

  if (!itemId) throw new ApiError(400, "itemId is required");

  const filter = {
    companyId:       req.companyId,
    financialYearId: req.fyId,
    "items.itemId":  itemId,       // query inside embedded array
    isActive:        true,
  };

  if (vendorId) filter.vendorId = vendorId;
  if (dateFrom || dateTo) {
    filter.purchaseDate = {};
    if (dateFrom) filter.purchaseDate.$gte = new Date(dateFrom);
    if (dateTo)   { const e = new Date(dateTo); e.setHours(23,59,59,999); filter.purchaseDate.$lte = e; }
  }

  const skip = (Number(page) - 1) * Number(limit);

  const invoices = await purchaseInvoiceModel.find(filter)
    .populate("vendorId",    "name phone")
    .populate("warehouseId", "name code")
    .select("invoiceNo purchaseDate vendorId vendorSnapshot warehouseId items grandTotal status")
    .sort({ purchaseDate: -1 })
    .skip(skip)
    .limit(Number(limit))
    .lean();

  const total = await purchaseInvoiceModel.countDocuments(filter);

  // Extract only the matching item row from each invoice
  const rows = invoices.map(inv => {
    const itemRow = inv.items.find(i => i.itemId?.toString() === itemId);
    return {
      _id:         inv._id,
      invoiceNo:   inv.invoiceNo,
      invoiceId:   inv._id,
      purchaseDate:inv.purchaseDate,
      vendor:      typeof inv.vendorId === "object" ? inv.vendorId : inv.vendorSnapshot,
      warehouse:   inv.warehouseId,
      hsn:         itemRow?.hsn        || "",
      qty:         itemRow?.qty        || 0,
      rate:        itemRow?.rate       || 0,
      taxableValue:itemRow?.taxableValue || 0,
      sgst:        itemRow?.sgst       || 0,
      cgst:        itemRow?.cgst       || 0,
      total:       itemRow?.total      || 0,
      taxPercent:  itemRow?.taxPercent || 0,
    };
  });

  // Summary
  const allInvoices = await purchaseInvoiceModel.find(filter).select("items").lean();
  const allRows     = allInvoices.flatMap(inv => inv.items.filter(i => i.itemId?.toString() === itemId));

  const summary = {
    totalBills:       total,
    totalQty:         Number(allRows.reduce((s, r) => s + r.qty,          0).toFixed(2)),
    totalValue:       Number(allRows.reduce((s, r) => s + r.total,        0).toFixed(2)),
    totalTaxable:     Number(allRows.reduce((s, r) => s + r.taxableValue, 0).toFixed(2)),
    avgRate:          allRows.length ? Number((allRows.reduce((s, r) => s + r.rate, 0) / allRows.length).toFixed(2)) : 0,
    minRate:          allRows.length ? Math.min(...allRows.map(r => r.rate)) : 0,
    maxRate:          allRows.length ? Math.max(...allRows.map(r => r.rate)) : 0,
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