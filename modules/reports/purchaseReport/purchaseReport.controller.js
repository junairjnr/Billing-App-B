import asyncHandler  from "../../../utils/asyncHandler.js";
import ApiResponse   from "../../../utils/ApiResponse.js";
import PurchaseInvoice from "../../purchase/purchaseInvoice/purchaseInvoice.model.js";


// ── 2. PURCHASE REPORT ────────────────────────────────────────
export const purchaseReport = asyncHandler(async (req, res) => {
  const {
    dateFrom,
    dateTo,
    vendorId,
    warehouseId,
    status,
    page  = 1,
    limit = 50,
  } = req.query;

  const filter = {
    companyId:       req.companyId,
    branchId:        req.branchId,
    financialYearId: req.fyId,
    isActive:        true,
  };

  // Date range
  if (dateFrom || dateTo) {
    filter.purchaseDate = {};
    if (dateFrom) filter.purchaseDate.$gte = new Date(dateFrom);
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      filter.purchaseDate.$lte = end;
    }
  }

  if (vendorId)     filter.vendorId     = vendorId;
  if (warehouseId)  filter.warehouseId  = warehouseId;
  if (status)       filter.status       = status;

  const skip = (Number(page) - 1) * Number(limit);

  const [data, total] = await Promise.all([
    PurchaseInvoice.find(filter)
      .populate("vendorId",    "name phone")
      .populate("warehouseId", "name code")
      .select("invoiceNo vendorInvoiceNo purchaseDate vendorId vendorSnapshot warehouseId items netAmount totalSGST totalCGST totalTax grandTotal status")
      .sort({ purchaseDate: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    PurchaseInvoice.countDocuments(filter),
  ]);

  // Summary totals
  const allData = await PurchaseInvoice.find(filter)
    .select("netAmount totalSGST totalCGST totalTax grandTotal")
    .lean();

  const summary = {
    totalInvoices:  total,
    totalNetAmount: Number(allData.reduce((s, r) => s + r.netAmount,  0).toFixed(2)),
    totalSGST:      Number(allData.reduce((s, r) => s + r.totalSGST,  0).toFixed(2)),
    totalCGST:      Number(allData.reduce((s, r) => s + r.totalCGST,  0).toFixed(2)),
    totalTax:       Number(allData.reduce((s, r) => s + r.totalTax,   0).toFixed(2)),
    grandTotal:     Number(allData.reduce((s, r) => s + r.grandTotal, 0).toFixed(2)),
  };

  res.json(new ApiResponse(200, {
    data,
    total,
    page:       Number(page),
    totalPages: Math.ceil(total / Number(limit)),
    hasNext:    Number(page) < Math.ceil(total / Number(limit)),
    summary,
  }));
});
