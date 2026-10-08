import asyncHandler from "../../../utils/asyncHandler.js";
import ApiResponse from "../../../utils/ApiResponse.js";
import SalesReturn from "../../sales/salesReturn/salesReturn.model.js";
import {
  getSalesReturnTaxTotals,
  withSalesReturnTaxTotals,
} from "./salesReturnReport.tax.js";
import { salesReturnReportSort } from "../../../utils/documentSort.js";
import {
  getDocumentDiscountAmount,
  sumDocumentItemQty,
} from "../../../utils/discountTotals.js";
import { regexContains } from "../../../utils/escapeRegex.js";
import { optionalSearchString } from "../../../utils/sanitizeInput.js";

export const salesReturnReport = asyncHandler(async (req, res) => {
  const {
    dateFrom,
    dateTo,
    customerId,
    salesType,
    warehouseId,
    returnMode,
    status,
    search,
    page = 1,
    limit = 50,
  } = req.query;

  const filter = {
    companyId: req.companyId,
    branchId: req.branchId,
    financialYearId: req.fyId,
    isActive: true,
  };

  if (dateFrom || dateTo) {
    filter.returnDate = {};
    if (dateFrom) filter.returnDate.$gte = new Date(dateFrom);
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      filter.returnDate.$lte = end;
    }
  }

  if (customerId) filter.customerId = customerId;
  if (salesType) filter.salesType = salesType;
  if (warehouseId) filter.warehouseId = warehouseId;
  if (returnMode) filter.returnMode = returnMode;
  if (status) filter.status = status;

  const safeSearch = optionalSearchString(search);
  if (safeSearch) {
    const pattern = regexContains(safeSearch);
    filter.$or = [
      { returnNo: pattern },
      { originalInvoiceNo: pattern },
      { "customerSnapshot.name": pattern },
    ];
  }

  const skip = (Number(page) - 1) * Number(limit);

  const [rawData, total] = await Promise.all([
    SalesReturn.find(filter)
      .populate("customerId", "name phone")
      .populate("warehouseId", "name code")
      .populate("salesInvoiceId", "invoiceNo")
      .select(
        "returnNo returnDate returnMode salesInvoiceId originalInvoiceNo referenceInvoiceNo salesType customerId customerSnapshot warehouseId priceLevelSnapshot items netAmount totalSGST totalCGST totalTax grandTotal status createdAt"
      )
      .sort(salesReturnReportSort)
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    SalesReturn.countDocuments(filter),
  ]);

  const data = rawData.map((row) => ({
    ...withSalesReturnTaxTotals(row),
    discountAmount: getDocumentDiscountAmount(row),
    totalQty: sumDocumentItemQty(row.items),
  }));

  const allData = await SalesReturn.find(filter)
    .select("items netAmount totalSGST totalCGST totalTax grandTotal salesType returnMode")
    .lean();

  const summary = allData.reduce(
    (acc, row) => {
      const tax = getSalesReturnTaxTotals(row);
      acc.totalNetAmount += row.netAmount ?? 0;
      acc.totalSGST += tax.totalSGST;
      acc.totalCGST += tax.totalCGST;
      acc.totalTax += tax.totalTax;
      acc.grandTotal += row.grandTotal ?? 0;
      acc.totalQty += sumDocumentItemQty(row.items);
      if (row.salesType === "retail") acc.retailCount += 1;
      if (row.salesType === "wholesale") acc.wholesaleCount += 1;
      if (row.returnMode === "invoice") acc.invoiceModeCount += 1;
      if (row.returnMode === "manual") acc.manualModeCount += 1;
      return acc;
    },
    {
      totalNetAmount: 0,
      totalQty: 0,
      totalSGST: 0,
      totalCGST: 0,
      totalTax: 0,
      grandTotal: 0,
      retailCount: 0,
      wholesaleCount: 0,
      invoiceModeCount: 0,
      manualModeCount: 0,
    }
  );

  summary.totalReturns = total;
  summary.totalQty = Number(summary.totalQty.toFixed(3));
  summary.totalNetAmount = Number(summary.totalNetAmount.toFixed(2));
  summary.totalSGST = Number(summary.totalSGST.toFixed(2));
  summary.totalCGST = Number(summary.totalCGST.toFixed(2));
  summary.totalTax = Number(summary.totalTax.toFixed(2));
  summary.grandTotal = Number(summary.grandTotal.toFixed(2));

  res.json(
    new ApiResponse(200, {
      data,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      hasNext: Number(page) < Math.ceil(total / Number(limit)),
      summary,
    })
  );
});
