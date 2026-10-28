import SalesInvoice from "../sales/salesInvoice/salesInvoice.model.js";
import PurchaseInvoice from "../purchase/purchaseInvoice/purchaseInvoice.model.js";
import Stock from "../stock/stock.model.js";
import Item from "../masters/item/item.model.js";
import StockLedger from "../stock/stockLedger.model.js";
import { getShopReport } from "../reports/shopReport/shopReport.service.js";
import salesInvoiceModel from "../sales/salesInvoice/salesInvoice.model.js";
import purchaseInvoiceModel from "../purchase/purchaseInvoice/purchaseInvoice.model.js";
import SalesReturn from "../sales/salesReturn/salesReturn.model.js";
import PurchaseReturn from "../purchase/purchaseReturn/purchaseReturn.model.js";
import Expense from "../expense/expense.model.js";
import { withSalesReturnTaxTotals } from "../reports/salesReturnReport/salesReturnReport.tax.js";
import {
  getSalesLineTaxAmounts,
  withSalesInvoiceTaxTotals,
} from "../reports/salesReport/salesReport.tax.js";
import {
  getDocumentDiscountAmount,
  sumDocumentItemQty,
} from "../../utils/discountTotals.js";
import {
  getPurchaseItemTaxAmounts,
  withPurchaseInvoiceTaxTotals,
} from "../reports/purchaseReport/purchaseReport.tax.js";
import {
  getPurchaseReturnItemTaxAmounts,
  withPurchaseReturnTaxTotals,
} from "../reports/purchaseReturnReport/purchaseReturnReport.tax.js";
import {
  compareByDateThenCreated,
  purchaseInvoiceReportSort,
  purchaseReturnReportSort,
  salesInvoiceReportSort,
  salesReturnReportSort,
} from "../../utils/documentSort.js";
import {
  optionalEnum,
  optionalObjectId,
  optionalSearchString,
} from "../../utils/sanitizeInput.js";
import { regexContains } from "../../utils/escapeRegex.js";
import { reportSearchMatcher } from "../reports/reportSearch.js";

const DEFAULT_GST_PERCENT = 18;
const EXPORT_LIMIT = 10000;

const DOC_STATUS = ["draft", "confirmed", "cancelled"];
const SALES_TYPES = ["retail", "wholesale"];
const RETURN_MODES = ["invoice", "manual"];
const STOCK_MOVEMENT_TYPES = [
  "purchase_in",
  "purchase_return",
  "sales_out",
  "sales_return",
  "transfer_in",
  "transfer_out",
  "adjustment_in",
  "adjustment_out",
  "opening_stock",
];
const SHOP_PARTY_TYPES = ["customer", "vendor"];

const sanitizeExportFilters = (query = {}) => ({
  customerId: optionalObjectId(query.customerId, "customerId"),
  vendorId: optionalObjectId(query.vendorId, "vendorId"),
  warehouseId: optionalObjectId(query.warehouseId, "warehouseId"),
  itemId: optionalObjectId(query.itemId, "itemId"),
  categoryId: optionalObjectId(query.categoryId, "categoryId"),
  partyId: optionalObjectId(query.partyId, "partyId"),
  salesType: optionalEnum(query.salesType, SALES_TYPES, "salesType"),
  status: optionalEnum(query.status, DOC_STATUS, "status"),
  returnMode: optionalEnum(query.returnMode, RETURN_MODES, "returnMode"),
  movementType: optionalEnum(query.movementType, STOCK_MOVEMENT_TYPES, "movementType"),
  partyType: optionalEnum(query.partyType, SHOP_PARTY_TYPES, "partyType"),
  category: optionalSearchString(query.category, 100),
  includeZero: query.includeZero === "true" ? "true" : undefined,
  search: optionalSearchString(query.search),
  dateFrom: typeof query.dateFrom === "string" ? query.dateFrom.trim() : undefined,
  dateTo: typeof query.dateTo === "string" ? query.dateTo.trim() : undefined,
});

const buildDateFilter = (query, field = "invoiceDate") => {
  const { dateFrom, dateTo } = query;
  if (!dateFrom && !dateTo) return {};
  const filter = {};
  filter[field] = {};
  if (dateFrom) filter[field].$gte = new Date(dateFrom);
  if (dateTo) {
    const end = new Date(dateTo);
    end.setHours(23, 59, 59, 999);
    filter[field].$lte = end;
  }
  return filter;
};

const baseScope = (ctx) => ({
  companyId: ctx.companyId,
  branchId: ctx.branchId,
  financialYearId: ctx.financialYearId,
  isActive: true,
});

const resolveLineItemName = (item) => {
  if (typeof item?.itemId === "object" && item.itemId?.name) return item.itemId.name;
  return item?.itemName || item?.name || "";
};

const resolveWarehouseName = (doc) => {
  if (typeof doc?.warehouseId === "object" && doc.warehouseId?.name) {
    return doc.warehouseId.name;
  }
  return doc?.warehouseSnapshot?.name || "";
};

const resolveVendorName = (doc) =>
  doc?.vendorSnapshot?.name ||
  (typeof doc?.vendorId === "object" ? doc.vendorId?.name : "") ||
  "";

const applyDocSearch = (filter, search, orFields) => {
  const safeSearch = optionalSearchString(search);
  if (safeSearch) {
    const pattern = regexContains(safeSearch);
    filter.$or = orFields.map((field) => ({ [field]: pattern }));
  }
  return filter;
};

export const fetchOperationalReportRows = async (reportType, ctx) => {
  const { companyId, branchId, financialYearId, query: rawQuery = {} } = ctx;
  const query = sanitizeExportFilters(rawQuery);

  switch (reportType) {
    case "sales-report": {
      const filter = { ...baseScope(ctx), ...buildDateFilter(query) };
      if (query.customerId) filter.customerId = query.customerId;
      if (query.salesType) filter.salesType = query.salesType;
      if (query.warehouseId) filter.warehouseId = query.warehouseId;
      if (query.status) filter.status = query.status;
      applyDocSearch(filter, query.search, ["invoiceNo", "customerSnapshot.name"]);
      const rows = await SalesInvoice.find(filter)
        .populate("customerId", "name phone")
        .populate("priceLevelId", "name")
        .select(
          "invoiceNo invoiceDate salesType customerSnapshot priceLevelSnapshot items cashDiscountAmt netAmount totalSGST totalCGST totalTax grandTotal status createdAt"
        )
        .sort(salesInvoiceReportSort)
        .limit(EXPORT_LIMIT)
        .lean();
      return rows.map(({ items, ...row }) => {
        const doc = { items, ...row };
        return {
          ...withSalesInvoiceTaxTotals(doc),
          discountAmount: getDocumentDiscountAmount(doc),
          totalQty: sumDocumentItemQty(items),
        };
      });
    }
    case "purchase-report": {
      const filter = { ...baseScope(ctx), ...buildDateFilter(query, "purchaseDate") };
      if (query.vendorId) filter.vendorId = query.vendorId;
      if (query.warehouseId) filter.warehouseId = query.warehouseId;
      if (query.status) filter.status = query.status;
      applyDocSearch(filter, query.search, [
        "invoiceNo",
        "vendorInvoiceNo",
        "vendorSnapshot.name",
      ]);
      const rows = await PurchaseInvoice.find(filter)
        .populate("vendorId", "name phone")
        .populate("warehouseId", "name code")
        .select(
          "invoiceNo purchaseDate vendorId vendorSnapshot warehouseId items netAmount totalSGST totalCGST totalTax grandTotal status"
        )
        .sort(purchaseInvoiceReportSort)
        .limit(EXPORT_LIMIT)
        .lean();
      return rows.map((row) => ({
        ...withPurchaseInvoiceTaxTotals(row),
        totalQty: sumDocumentItemQty(row.items),
      }));
    }
    case "sales-return-report": {
      const filter = { ...baseScope(ctx), ...buildDateFilter(query, "returnDate") };
      if (query.customerId) filter.customerId = query.customerId;
      if (query.salesType) filter.salesType = query.salesType;
      if (query.warehouseId) filter.warehouseId = query.warehouseId;
      if (query.returnMode) filter.returnMode = query.returnMode;
      if (query.status) filter.status = query.status;
      applyDocSearch(filter, query.search, [
        "returnNo",
        "originalInvoiceNo",
        "customerSnapshot.name",
      ]);
      const rows = await SalesReturn.find(filter)
        .populate("customerId", "name phone")
        .select(
          "returnNo returnDate returnMode originalInvoiceNo salesType customerSnapshot priceLevelSnapshot items netAmount totalSGST totalCGST totalTax grandTotal status createdAt"
        )
        .sort(salesReturnReportSort)
        .limit(EXPORT_LIMIT)
        .lean();
      return rows.map((row) => ({
        ...withSalesReturnTaxTotals(row),
        discountAmount: getDocumentDiscountAmount(row),
        totalQty: sumDocumentItemQty(row.items),
      }));
    }
    case "purchase-return-report": {
      const filter = { ...baseScope(ctx), ...buildDateFilter(query, "returnDate") };
      if (query.vendorId) filter.vendorId = query.vendorId;
      if (query.warehouseId) filter.warehouseId = query.warehouseId;
      if (query.returnMode) filter.returnMode = query.returnMode;
      if (query.status) filter.status = query.status;
      applyDocSearch(filter, query.search, [
        "returnNo",
        "originalInvoiceNo",
        "vendorSnapshot.name",
      ]);
      const rows = await PurchaseReturn.find(filter)
        .populate("vendorId", "name phone")
        .populate("warehouseId", "name")
        .select(
          "returnNo returnDate returnMode originalInvoiceNo vendorSnapshot warehouseId items netAmount totalSGST totalCGST totalTax grandTotal status"
        )
        .sort(purchaseReturnReportSort)
        .limit(EXPORT_LIMIT)
        .lean();
      return rows.map((row) => ({
        ...withPurchaseReturnTaxTotals(row),
        totalQty: sumDocumentItemQty(row.items),
      }));
    }
    case "stock-report": {
      const filter = { companyId, financialYearId };
      if (query.warehouseId) filter.warehouseId = query.warehouseId;
      if (query.itemId) filter.itemId = query.itemId;
      if (query.includeZero !== "true") filter.qty = { $gt: 0 };
      if (query.categoryId) {
        const items = await Item.find({ companyId, categoryId: query.categoryId }).select("_id").lean();
        filter.itemId = query.itemId
          ? { $in: items.map((i) => i._id).filter((id) => id.toString() === query.itemId) }
          : { $in: items.map((i) => i._id) };
      }
      const matchesSearch = reportSearchMatcher(query.search);
      const rows = await Stock.find(filter)
        .populate({ path: "itemId", select: "name code hsnCode categoryId uomId taxPercent price", populate: [{ path: "categoryId", select: "name" }, { path: "uomId", select: "name" }] })
        .populate("warehouseId", "name code")
        .lean();
      return rows
        .filter((row) => matchesSearch(row.itemId?.name, row.itemId?.code))
        .map((row) => {
        const rate = Number(row.itemId?.price) || Number(row.avgCost) || 0;
        const stockValue = Number((row.qty * rate).toFixed(2));
        const taxPercent = Number(row.itemId?.taxPercent) || DEFAULT_GST_PERCENT;
        const sgst = Number(((stockValue * taxPercent) / 200).toFixed(2));
        const cgst = Number(((stockValue * taxPercent) / 200).toFixed(2));
        const stockValueTotal = Number((stockValue + sgst + cgst).toFixed(2));
        return { ...row, rate, stockValue, sgst, cgst, stockValueTotal };
      });
    }
    case "ledger-report": {
      if (!query.itemId) return [];
      const filter = { companyId, financialYearId, itemId: query.itemId };
      if (query.warehouseId) filter.warehouseId = query.warehouseId;
      if (query.movementType) filter.movementType = query.movementType;
      Object.assign(filter, buildDateFilter(query, "createdAt"));
      applyDocSearch(filter, query.search, ["referenceNo", "notes"]);
      return StockLedger.find(filter)
        .populate({ path: "itemId", select: "name code uomId", populate: { path: "uomId", select: "name" } })
        .populate("warehouseId", "name code")
        .sort({ createdAt: -1 })
        .limit(EXPORT_LIMIT)
        .lean();
    }
    case "shop-report": {
      const data = await getShopReport({
        companyId,
        financialYearId,
        partyType: query.partyType,
        partyId: query.partyId || query.customerId || query.vendorId,
        salesType: query.salesType,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        search: query.search,
        page: 1,
        limit: EXPORT_LIMIT,
      });
      return data.rows || [];
    }
    case "sales-history": {
      const filter = {
        companyId,
        branchId,
        financialYearId,
        isActive: true,
        ...buildDateFilter(query),
      };
      if (query.itemId) filter["items.itemId"] = query.itemId;
      if (query.customerId) filter.customerId = query.customerId;
      if (query.salesType) filter.salesType = query.salesType;
      const invoices = await salesInvoiceModel.find(filter).populate("customerId", "name").populate("items.itemId", "name hsnCode").select("invoiceNo invoiceDate salesType customerSnapshot priceLevelSnapshot items grandTotal status createdAt").sort(salesInvoiceReportSort).limit(EXPORT_LIMIT).lean();
      const rows = [];
      for (const inv of invoices) {
        for (const item of inv.items || []) {
          if (query.itemId && item.itemId?.toString() !== query.itemId && item.itemId?._id?.toString() !== query.itemId) continue;
          const { taxableValue, sgst, cgst } = getSalesLineTaxAmounts(item);
          rows.push({ invoiceNo: inv.invoiceNo, date: inv.invoiceDate, createdAt: inv.createdAt, salesType: inv.salesType, customer: inv.customerSnapshot?.name || "", priceLevel: inv.priceLevelSnapshot?.name || "", itemName: item.name || item.itemSnapshot?.name || (typeof item.itemId === "object" ? item.itemId?.name : "") || "", hsn: item.hsn || (typeof item.itemId === "object" ? item.itemId?.hsnCode : "") || "", discount: Number(item.discount) || 0, qty: item.qty, rate: item.rate, taxableValue, sgst, cgst, total: item.total ?? Number((taxableValue + sgst + cgst).toFixed(2)), status: inv.status });
        }
      }
      const matchesSearch = reportSearchMatcher(query.search);
      rows.sort(compareByDateThenCreated("date"));
      return rows.filter((row) =>
        matchesSearch(row.invoiceNo, row.customer, row.itemName)
      );
    }
    case "purchase-history": {
      const filter = {
        companyId,
        branchId,
        financialYearId,
        isActive: true,
        ...buildDateFilter(query, "purchaseDate"),
      };
      if (query.itemId) filter["items.itemId"] = query.itemId;
      if (query.vendorId) filter.vendorId = query.vendorId;
      const invoices = await purchaseInvoiceModel.find(filter).populate("vendorId", "name").populate("warehouseId", "name code").populate("items.itemId", "name hsnCode").select("invoiceNo purchaseDate vendorId vendorSnapshot warehouseId items grandTotal status createdAt").sort(purchaseInvoiceReportSort).limit(EXPORT_LIMIT).lean();
      const rows = [];
      for (const inv of invoices) {
        for (const item of inv.items || []) {
          if (query.itemId && item.itemId?.toString() !== query.itemId && item.itemId?._id?.toString() !== query.itemId) continue;
          const tax = getPurchaseItemTaxAmounts(item);
          const itemLabel = resolveLineItemName(item);
          rows.push({
            invoiceNo: inv.invoiceNo,
            date: inv.purchaseDate,
            createdAt: inv.createdAt,
            vendor: resolveVendorName(inv),
            warehouse: resolveWarehouseName(inv),
            item: itemLabel,
            itemName: itemLabel,
            hsn: item.hsn || (typeof item.itemId === "object" ? item.itemId?.hsnCode : "") || "",
            discount: Number(item.discount) || 0,
            qty: item.qty,
            rate: item.rate,
            taxableValue: tax.taxableValue,
            sgst: tax.sgst,
            cgst: tax.cgst,
            total: tax.total,
            status: inv.status,
          });
        }
      }
      const matchesSearch = reportSearchMatcher(query.search);
      rows.sort(compareByDateThenCreated("date"));
      return rows.filter((row) =>
        matchesSearch(row.invoiceNo, row.vendor, row.itemName)
      );
    }
    case "sales-return-history": {
      const filter = {
        companyId,
        branchId,
        financialYearId,
        isActive: true,
        ...buildDateFilter(query, "returnDate"),
      };
      if (query.itemId) filter["items.itemId"] = query.itemId;
      if (query.customerId) filter.customerId = query.customerId;
      const returns = await SalesReturn.find(filter).populate("customerId", "name").populate("items.itemId", "name hsnCode").select("returnNo returnDate originalInvoiceNo salesType customerSnapshot items grandTotal status createdAt").sort(salesReturnReportSort).limit(EXPORT_LIMIT).lean();
      const rows = [];
      for (const ret of returns) {
        for (const item of ret.items || []) {
          if (query.itemId && item.itemId?.toString() !== query.itemId && item.itemId?._id?.toString() !== query.itemId) continue;
          const { taxableValue, sgst, cgst } = getSalesLineTaxAmounts(item);
          rows.push({ returnNo: ret.returnNo, date: ret.returnDate, createdAt: ret.createdAt, originalInvoice: ret.originalInvoiceNo || "", salesType: ret.salesType || "", customer: ret.customerSnapshot?.name || "", itemName: item.name || (typeof item.itemId === "object" ? item.itemId?.name : "") || "", hsn: item.hsn || (typeof item.itemId === "object" ? item.itemId?.hsnCode : "") || "", discount: Number(item.discount) || 0, qty: item.qty, rate: item.rate, taxableValue, sgst, cgst, total: item.total ?? Number((taxableValue + sgst + cgst).toFixed(2)), status: ret.status });
        }
      }
      const matchesSearch = reportSearchMatcher(query.search);
      rows.sort(compareByDateThenCreated("date"));
      return rows.filter((row) =>
        matchesSearch(row.returnNo, row.originalInvoice, row.customer, row.itemName)
      );
    }
    case "purchase-return-history": {
      const filter = {
        companyId,
        branchId,
        financialYearId,
        isActive: { $ne: false },
        status: "confirmed",
        ...buildDateFilter(query, "returnDate"),
      };
      if (query.itemId) filter["items.itemId"] = query.itemId;
      if (query.vendorId) filter.vendorId = query.vendorId;
      const returns = await PurchaseReturn.find(filter)
        .populate("vendorId", "name")
        .populate("items.itemId", "name hsnCode")
        .select(
          "returnNo returnDate originalInvoiceNo vendorId vendorSnapshot items grandTotal status createdAt"
        )
        .sort(purchaseReturnReportSort)
        .limit(EXPORT_LIMIT)
        .lean();
      const rows = [];
      for (const ret of returns) {
        for (const item of ret.items || []) {
          if (query.itemId && item.itemId?.toString() !== query.itemId && item.itemId?._id?.toString() !== query.itemId) continue;
          const tax = getPurchaseReturnItemTaxAmounts(item);
          const itemLabel = resolveLineItemName(item);
          rows.push({
            returnNo: ret.returnNo,
            date: ret.returnDate,
            createdAt: ret.createdAt,
            originalInvoice: ret.originalInvoiceNo || "",
            originalInvoiceNo: ret.originalInvoiceNo || "",
            vendor: resolveVendorName(ret),
            item: itemLabel,
            itemName: itemLabel,
            hsn: item.hsn || (typeof item.itemId === "object" ? item.itemId?.hsnCode : "") || "",
            discount: Number(item.discount) || 0,
            qty: item.qty,
            rate: item.rate,
            taxableValue: tax.taxableValue,
            sgst: tax.sgst,
            cgst: tax.cgst,
            total: tax.total,
            status: ret.status,
          });
        }
      }
      const matchesSearch = reportSearchMatcher(query.search);
      rows.sort(compareByDateThenCreated("date"));
      return rows.filter((row) =>
        matchesSearch(row.returnNo, row.originalInvoice, row.vendor, row.itemName)
      );
    }
    case "expense-report": {
      const filter = { companyId, branchId, financialYearId, isActive: { $ne: false } };
      if (query.category) filter.category = query.category;
      Object.assign(filter, buildDateFilter(query, "date"));
      applyDocSearch(filter, query.search, ["expenseNo", "title"]);
      return Expense.find(filter).select("expenseNo date category title amount paymentMode referenceNo notes").sort({ date: -1 }).limit(EXPORT_LIMIT).lean();
    }
    default:
      return undefined;
  }
};
