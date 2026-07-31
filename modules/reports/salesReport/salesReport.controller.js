import asyncHandler  from "../../../utils/asyncHandler.js";
import ApiResponse   from "../../../utils/ApiResponse.js";
import SalesInvoice    from "../../sales/salesInvoice/salesInvoice.model.js";



// ── 3. SALES REPORT ───────────────────────────────────────────
export const salesReport = asyncHandler(async (req, res) => {
  const {
    dateFrom,
    dateTo,
    customerId,
    salesType,
    warehouseId,
    priceLevelId,
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
    filter.invoiceDate = {};
    if (dateFrom) filter.invoiceDate.$gte = new Date(dateFrom);
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      filter.invoiceDate.$lte = end;
    }
  }

  if (customerId)   filter.customerId   = customerId;
  if (salesType)    filter.salesType    = salesType;
  if (warehouseId)  filter.warehouseId  = warehouseId;
  if (priceLevelId) filter.priceLevelId = priceLevelId;
  if (status)       filter.status       = status;

  const skip = (Number(page) - 1) * Number(limit);

  const [data, total] = await Promise.all([
    SalesInvoice.find(filter)
      .populate("customerId",   "name phone")
      .populate("warehouseId",  "name code")
      .populate("priceLevelId", "name taxPercent")
      .select("invoiceNo invoiceDate salesType customerId customerSnapshot warehouseId priceLevelSnapshot netAmount totalSGST totalCGST totalTax grandTotal status")
      .sort({ invoiceDate: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    SalesInvoice.countDocuments(filter),
  ]);

  // Summary totals
  const allData = await SalesInvoice.find(filter)
    .select("netAmount totalSGST totalCGST totalTax grandTotal salesType")
    .lean();

  const summary = {
    totalInvoices:      total,
    retailCount:        allData.filter((r) => r.salesType === "retail").length,
    wholesaleCount:     allData.filter((r) => r.salesType === "wholesale").length,
    totalNetAmount:     Number(allData.reduce((s, r) => s + r.netAmount,  0).toFixed(2)),
    totalSGST:          Number(allData.reduce((s, r) => s + r.totalSGST,  0).toFixed(2)),
    totalCGST:          Number(allData.reduce((s, r) => s + r.totalCGST,  0).toFixed(2)),
    totalTax:           Number(allData.reduce((s, r) => s + r.totalTax,   0).toFixed(2)),
    grandTotal:         Number(allData.reduce((s, r) => s + r.grandTotal, 0).toFixed(2)),
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
