import SalesInvoice from "../sales/salesInvoice/salesInvoice.model.js";
import PurchaseInvoice from "../purchase/purchaseInvoice/purchaseInvoice.model.js";
import SalesReturn from "../sales/salesReturn/salesReturn.model.js";
import PurchaseReturn from "../purchase/purchaseReturn/purchaseReturn.model.js";
import ReceiptPayment from "../receipt-payment/receiptPayment.model.js";
import Expense from "../expense/expense.model.js";
import JournalEntry from "../accounting/journal/journalEntry.model.js";
import FinancialYear from "../financialYear/financialYear.model.js";
import Company from "../company/company.model.js";
import ApiError from "../../utils/ApiError.js";
import {
  getFYDocumentCode,
  getFYShortLabel,
  getDocumentSequence,
} from "../../utils/fyCode.js";
import { escapeRegex } from "../../utils/escapeRegex.js";

export const DOCUMENT_TYPES = {
  SALES_INVOICE: "sales_invoice",
  PURCHASE_INVOICE: "purchase_invoice",
  SALES_RETURN: "sales_return",
  PURCHASE_RETURN: "purchase_return",
  RECEIPT: "receipt",
  PAYMENT: "payment",
  EXPENSE: "expense",
  JOURNAL: "journal",
};

const voucherPrefix = (voucherType) => (voucherType === "receipt" ? "RCPT" : "PAY");

/** Company code used in front of every document number, e.g. PKS */
const getCompanyCode = async (companyId) => {
  const company = await Company.findById(companyId).select("code name");
  if (!company) throw new ApiError(404, "Company not found");
  const companyCode = company.code?.toUpperCase();
  if (!companyCode) {
    throw new ApiError(
      400,
      "Company code not set. Set company code in company settings before creating vouchers."
    );
  }
  return companyCode;
};

/** Next sequence: PKS/RCPT/2026-27/01 (min 2 digits; grows to 10, 100, …) */
const nextSlashSequence = async (Model, field, filter, prefix, minPad = 2) => {
  const last = await Model.findOne(
    { ...filter, [field]: { $regex: `^${prefix.replace(/\//g, "\\/")}` } },
    { [field]: 1 },
    { sort: { createdAt: -1 } }
  );

  if (!last) return `${prefix}${String(1).padStart(minPad, "0")}`;

  const lastNo = parseInt(String(last[field]).split("/").pop(), 10) || 0;
  return `${prefix}${String(lastNo + 1).padStart(minPad, "0")}`;
};

/** Sales: PKS/WH/26-27/01 or PKS/RT/26-27/01 (FY uses last two digits per year) */
export const getNextSalesInvoiceNo = async (companyId, financialYearId, salesType) => {
  const [fy, company] = await Promise.all([
    FinancialYear.findById(financialYearId),
    Company.findById(companyId).select("code name"),
  ]);
  if (!fy) throw new ApiError(404, "Financial year not found");
  if (!company) throw new ApiError(404, "Company not found");

  const companyCode = company.code?.toUpperCase();
  if (!companyCode) {
    throw new ApiError(
      400,
      "Company code not set. Set company code in company settings before creating invoices."
    );
  }

  const typeCode = salesType === "retail" ? "RT" : "WH";
  const fySegment = getFYShortLabel(fy.label);
  const prefix = `${companyCode}/${typeCode}/${fySegment}/`;

  const invoiceNoPattern = new RegExp(
    `^${escapeRegex(companyCode)}/${escapeRegex(typeCode)}/[^/]+/`,
    "i"
  );

  const last = await SalesInvoice.findOne(
    {
      companyId,
      financialYearId,
      salesType,
      invoiceNo: { $regex: invoiceNoPattern },
    },
    { invoiceNo: 1 },
    { sort: { createdAt: -1 } }
  );

  if (!last) return `${prefix}01`;

  const lastNo = parseInt(last.invoiceNo.split("/").pop(), 10) || 0;
  return `${prefix}${String(lastNo + 1).padStart(2, "0")}`;
};

/** Purchase: PKS/PI/26-27/01 (FY uses last two digits per year) */
export const getNextPurchaseInvoiceNo = async (companyId, financialYearId) => {
  const [fy, company] = await Promise.all([
    FinancialYear.findById(financialYearId),
    Company.findById(companyId).select("code name"),
  ]);
  if (!fy) throw new ApiError(404, "Financial year not found");
  if (!company) throw new ApiError(404, "Company not found");

  const companyCode = company.code?.toUpperCase();
  if (!companyCode) {
    throw new ApiError(
      400,
      "Company code not set. Set company code in company settings before creating invoices."
    );
  }

  const typeCode = "PI";
  const fySegment = getFYShortLabel(fy.label);
  const prefix = `${companyCode}/${typeCode}/${fySegment}/`;

  const docNoPattern = new RegExp(
    `^${escapeRegex(companyCode)}/${escapeRegex(typeCode)}/[^/]+/`,
    "i"
  );

  const last = await PurchaseInvoice.findOne(
    {
      companyId,
      financialYearId,
      invoiceNo: { $regex: docNoPattern },
    },
    { invoiceNo: 1 },
    { sort: { createdAt: -1 } }
  );

  if (!last) return `${prefix}01`;

  const lastNo = parseInt(last.invoiceNo.split("/").pop(), 10) || 0;
  return `${prefix}${String(lastNo + 1).padStart(2, "0")}`;
};

/** Sales return: PKS/SR-WH/26-27/01 or PKS/SR-RT/26-27/01 */
export const getNextSalesReturnNo = async (companyId, financialYearId, salesType) => {
  const [fy, company] = await Promise.all([
    FinancialYear.findById(financialYearId),
    Company.findById(companyId).select("code name"),
  ]);
  if (!fy) throw new ApiError(404, "Financial year not found");
  if (!company) throw new ApiError(404, "Company not found");

  const companyCode = company.code?.toUpperCase();
  if (!companyCode) {
    throw new ApiError(400, "Company code not set. Set company code before creating returns.");
  }

  const typeCode = salesType === "retail" ? "SR-RT" : "SR-WH";
  const fySegment = getFYShortLabel(fy.label);
  const prefix = `${companyCode}/${typeCode}/${fySegment}/`;

  const docNoPattern = new RegExp(
    `^${escapeRegex(companyCode)}/${escapeRegex(typeCode)}/[^/]+/`,
    "i"
  );

  const last = await SalesReturn.findOne(
    {
      companyId,
      financialYearId,
      salesType,
      returnNo: { $regex: docNoPattern },
    },
    { returnNo: 1 },
    { sort: { createdAt: -1 } }
  );

  if (!last) return `${prefix}01`;

  const lastNo = parseInt(last.returnNo.split("/").pop(), 10) || 0;
  return `${prefix}${String(lastNo + 1).padStart(2, "0")}`;
};

/** Purchase return: PKS/PR/26-27/01 */
export const getNextPurchaseReturnNo = async (companyId, financialYearId) => {
  const [fy, company] = await Promise.all([
    FinancialYear.findById(financialYearId),
    Company.findById(companyId).select("code name"),
  ]);
  if (!fy) throw new ApiError(404, "Financial year not found");
  if (!company) throw new ApiError(404, "Company not found");

  const companyCode = company.code?.toUpperCase();
  if (!companyCode) {
    throw new ApiError(400, "Company code not set. Set company code before creating returns.");
  }

  const typeCode = "PR";
  const fySegment = getFYShortLabel(fy.label);
  const prefix = `${companyCode}/${typeCode}/${fySegment}/`;

  const docNoPattern = new RegExp(
    `^${escapeRegex(companyCode)}/${escapeRegex(typeCode)}/[^/]+/`,
    "i"
  );

  const last = await PurchaseReturn.findOne(
    {
      companyId,
      financialYearId,
      returnNo: { $regex: docNoPattern },
    },
    { returnNo: 1 },
    { sort: { createdAt: -1 } }
  );

  if (!last) return `${prefix}01`;

  const lastNo = parseInt(last.returnNo.split("/").pop(), 10) || 0;
  return `${prefix}${String(lastNo + 1).padStart(2, "0")}`;
};

/** Receipt / Payment: PKS/RCPT/2026-27/01 or PKS/PAY/2026-27/01 */
export const getNextVoucherNo = async (companyId, financialYearId, voucherType) => {
  const [fy, companyCode] = await Promise.all([
    FinancialYear.findById(financialYearId),
    getCompanyCode(companyId),
  ]);
  if (!fy) throw new ApiError(404, "Financial year not found");

  const prefix = `${companyCode}/${voucherPrefix(voucherType)}/${fy.label}/`;

  return nextSlashSequence(
    ReceiptPayment,
    "voucherNo",
    { companyId, financialYearId, voucherType },
    prefix
  );
};

/** Expense: PKS/EXP/2026-27/01 */
export const getNextExpenseNo = async (companyId, financialYearId) => {
  const [fy, companyCode] = await Promise.all([
    FinancialYear.findById(financialYearId),
    getCompanyCode(companyId),
  ]);
  if (!fy) throw new ApiError(404, "Financial year not found");

  const prefix = `${companyCode}/EXP/${fy.label}/`;

  return nextSlashSequence(
    Expense,
    "expenseNo",
    { companyId, financialYearId },
    prefix
  );
};

/** Journal: JE-2026-2027-0001 */
export const getNextJournalNo = async (companyId, financialYearId, session = null) => {
  const fy = await FinancialYear.findById(financialYearId).session(session);
  if (!fy) throw new ApiError(404, "Financial year not found");

  const prefix = `JE-${getFYDocumentCode(fy.label)}`;
  const last = await JournalEntry.findOne(
    { companyId, financialYearId },
    { journalNo: 1 },
    { sort: { createdAt: -1 } }
  ).session(session);

  if (!last) return `${prefix}-0001`;

  const lastNo = getDocumentSequence(last.journalNo);
  return `${prefix}-${String(lastNo + 1).padStart(4, "0")}`;
};

export const getNextDocumentNumber = async (
  companyId,
  financialYearId,
  documentType,
  { salesType, salesInvoiceId } = {}
) => {
  switch (documentType) {
    case DOCUMENT_TYPES.SALES_INVOICE: {
      if (!salesType) throw new ApiError(400, "salesType is required (retail or wholesale)");
      const nextNumber = await getNextSalesInvoiceNo(companyId, financialYearId, salesType);
      return { documentType, nextNumber, salesType };
    }
    case DOCUMENT_TYPES.PURCHASE_INVOICE: {
      const nextNumber = await getNextPurchaseInvoiceNo(companyId, financialYearId);
      return { documentType, nextNumber };
    }
    case DOCUMENT_TYPES.SALES_RETURN: {
      let resolvedSalesType = salesType;
      if (!resolvedSalesType && salesInvoiceId) {
        const invoice = await SalesInvoice.findOne({
          _id: salesInvoiceId,
          companyId,
          financialYearId,
        }).select("salesType");
        if (!invoice) throw new ApiError(404, "Sales invoice not found");
        resolvedSalesType = invoice.salesType;
      }
      if (!resolvedSalesType) {
        throw new ApiError(400, "salesType or salesInvoiceId is required for sales return number");
      }
      const nextNumber = await getNextSalesReturnNo(
        companyId,
        financialYearId,
        resolvedSalesType
      );
      return { documentType, nextNumber, salesType: resolvedSalesType };
    }
    case DOCUMENT_TYPES.PURCHASE_RETURN: {
      const nextNumber = await getNextPurchaseReturnNo(companyId, financialYearId);
      return { documentType, nextNumber };
    }
    case DOCUMENT_TYPES.RECEIPT: {
      const nextNumber = await getNextVoucherNo(companyId, financialYearId, "receipt");
      return { documentType, nextNumber };
    }
    case DOCUMENT_TYPES.PAYMENT: {
      const nextNumber = await getNextVoucherNo(companyId, financialYearId, "payment");
      return { documentType, nextNumber };
    }
    case DOCUMENT_TYPES.EXPENSE: {
      const nextNumber = await getNextExpenseNo(companyId, financialYearId);
      return { documentType, nextNumber };
    }
    case DOCUMENT_TYPES.JOURNAL: {
      const nextNumber = await getNextJournalNo(companyId, financialYearId);
      return { documentType, nextNumber };
    }
    default:
      throw new ApiError(
        400,
        `Invalid documentType. Allowed: ${Object.values(DOCUMENT_TYPES).join(", ")}`
      );
  }
};
