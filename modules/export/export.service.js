import customerModel from "../masters/customer/customer.model.js";
import itemModel from "../masters/item/item.model.js";
import Warehouse from "../warehouse/warehouse.model.js";
import * as salesService from "../sales/salesInvoice/salesInvoice.service.js";
import * as salesReturnService from "../sales/salesReturn/salesReturn.service.js";
import * as purchaseService from "../purchase/purchaseInvoice/purchaseInvoice.services.js";
import * as purchaseReturnService from "../purchase/purchaseReturn/purchaseReturn.service.js";
import * as receiptService from "../receipt-payment/receiptPayment.service.js";
import * as expenseService from "../expense/expense.service.js";
import * as journalService from "../accounting/journal/journal.service.js";
import * as reportsService from "../accounting/reports/financialReports.service.js";
import * as coaService from "../accounting/chartOfAccount/chartOfAccount.service.js";
import { getReportConfig } from "./export.config.js";
import { fetchOperationalReportRows } from "./exportReportData.js";
import { resolveSelectedColumns } from "./exportColumnResolver.js";

const EXPORT_ROW_LIMIT = 10000;
const EXPORT_FILTER_KEYS = [
  "search",
  "type",
  "salesType",
  "salesInvoiceId",
  "purchaseInvoiceId",
  "partyId",
  "customerId",
  "vendorId",
  "paymentMode",
  "dateFrom",
  "dateTo",
  "status",
  "category",
  "accountType",
  "referenceType",
];

const scope = (ctx) => ({
  companyId: ctx.companyId,
  branchId: ctx.branchId,
  financialYearId: ctx.financialYearId,
  dateFrom: ctx.query?.dateFrom,
  dateTo: ctx.query?.dateTo,
});

const plainQueryValue = (value) => {
  if (typeof value === "string") return value.trim().slice(0, 200);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
};

/**
 * Client query may only carry known filters and paging. Tenant keys and
 * operator objects are dropped so a request can never widen scope.
 */
const exportQuery = (ctx) => {
  const query = ctx.query ?? {};
  const requestedLimit = Number(query.limit);
  const requestedPage = Number(query.page);
  const filters = {};

  for (const key of EXPORT_FILTER_KEYS) {
    const value = plainQueryValue(query[key]);
    if (value !== undefined && value !== "") filters[key] = value;
  }

  return {
    ...filters,
    page: requestedPage > 0 ? requestedPage : 1,
    limit:
      requestedLimit > 0
        ? Math.min(requestedLimit, EXPORT_ROW_LIMIT)
        : EXPORT_ROW_LIMIT,
  };
};

const fetchRows = async (reportType, ctx) => {
  const { companyId } = ctx;

  switch (reportType) {
    case "customers": {
      const filter = { companyId };
      const type = exportQuery(ctx).type;
      if (typeof type === "string" && type) filter.type = type;
      return customerModel
        .find(filter)
        .select("name email phone gstin customerType address type")
        .sort({ name: 1 })
        .lean();
    }
    case "products":
      return itemModel
        .find({ companyId })
        .select("name code hsnCode price taxPercent uomId categoryId")
        .populate([
          { path: "categoryId", select: "name" },
          { path: "uomId", select: "name shortCode" },
        ])
        .sort({ name: 1 })
        .lean();
    case "warehouses":
      return Warehouse.find({ companyId }).sort({ name: 1 }).lean();
    case "sales": {
      const result = await salesService.getAllSalesInvoices({
        companyId,
        branchId: ctx.branchId,
        financialYearId: ctx.financialYearId,
        ...exportQuery(ctx),
      });
      return result.data || result;
    }
    case "purchase": {
      const result = await purchaseService.getAllPurchaseInvoices({
        companyId,
        branchId: ctx.branchId,
        financialYearId: ctx.financialYearId,
        ...exportQuery(ctx),
      });
      return result.data || result;
    }
    case "sales-returns": {
      const result = await salesReturnService.getAllSalesReturns({
        companyId,
        branchId: ctx.branchId,
        financialYearId: ctx.financialYearId,
        ...exportQuery(ctx),
      });
      return result.data || result;
    }
    case "purchase-returns": {
      const result = await purchaseReturnService.getAllPurchaseReturns({
        companyId,
        branchId: ctx.branchId,
        financialYearId: ctx.financialYearId,
        ...exportQuery(ctx),
      });
      return result.data || result;
    }
    case "receipts": {
      const q = exportQuery(ctx);
      const result = await receiptService.getAllVouchers({
        companyId,
        branchId: ctx.branchId,
        financialYearId: ctx.financialYearId,
        voucherType: "receipt",
        ...q,
        partyId: q.partyId || q.customerId,
      });
      return result.data || result;
    }
    case "payments": {
      const q = exportQuery(ctx);
      const result = await receiptService.getAllVouchers({
        companyId,
        branchId: ctx.branchId,
        financialYearId: ctx.financialYearId,
        voucherType: "payment",
        ...q,
        partyId: q.partyId || q.vendorId,
      });
      return result.data || result;
    }
    case "expenses": {
      const result = await expenseService.listExpenses(
        {
          companyId,
          branchId: ctx.branchId,
          financialYearId: ctx.financialYearId,
        },
        exportQuery(ctx)
      );
      return result.data || result;
    }
    case "journals": {
      const result = await journalService.listJournalEntries({
        companyId,
        branchId: ctx.branchId,
        financialYearId: ctx.financialYearId,
        ...exportQuery(ctx),
      });
      return result.data || result;
    }
    case "trial-balance": {
      const data = await reportsService.getTrialBalance(scope(ctx));
      return data.rows || [];
    }
    case "customer-balances":
      return reportsService.getAllPartyBalances(scope(ctx), "customer");
    case "chart-of-accounts":
      return coaService.listAccounts(companyId, exportQuery(ctx));
    case "profit-loss": {
      const data = await reportsService.getProfitAndLoss(scope(ctx));
      return [
        ...(data.income || []).map((r) => ({ ...r, section: "Income" })),
        ...(data.expenses || []).map((r) => ({ ...r, section: "Expenses" })),
      ];
    }
    case "balance-sheet": {
      const data = await reportsService.getBalanceSheet(scope(ctx));
      return [
        ...(data.assets || []).map((r) => ({ ...r, section: "Assets" })),
        ...(data.liabilities || []).map((r) => ({ ...r, section: "Liabilities" })),
        ...(data.equity || []).map((r) => ({ ...r, section: "Equity" })),
      ];
    }
    default: {
      const operational = await fetchOperationalReportRows(reportType, ctx);
      if (operational !== undefined) return operational;
      return null;
    }
  }
};

export const exportReport = async (reportType, ctx, selectedColumns) => {
  const config = getReportConfig(reportType);
  if (!config) return null;

  const rows = await fetchRows(reportType, ctx);
  if (rows === null) return null;

  const selected = resolveSelectedColumns(config, selectedColumns);

  return {
    rows,
    columns: selected,
    filename: config.filename,
    sheetName: config.sheetName,
  };
};
