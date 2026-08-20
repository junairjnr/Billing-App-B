import SalesInvoice  from "./salesInvoice.model.js";
import Customer      from "../../masters/customer/customer.model.js";
import Item          from "../../masters/item/item.model.js";
import PriceLevel    from "../../masters/priceLevel/priceLevel.model.js";
import FinancialYear from "../../financialYear/financialYear.model.js";
import Company       from "../../company/company.model.js";
import { moveStock } from "../../stock/stock.services.js";
import ApiError      from "../../../utils/ApiError.js";
import { withTransaction, sessionOpts } from "../../../utils/withTransaction.js";

// ── Generate sales invoice number ─────────────────────────────
// wholesale → PKS/WH/2026-27/01
// retail    → PKS/RT/2026-27/01
const generateSalesInvoiceNo = async (companyId, financialYearId, salesType) => {
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
      "Company code not set. Set company code to PKS in company settings (PUT /api/companies/:id with { code: \"PKS\" })."
    );
  }

  const typeCode = salesType === "retail" ? "RT" : "WH";
  const prefix = `${companyCode}/${typeCode}/${fy.label}/`;

  const last = await SalesInvoice.findOne(
    {
      companyId,
      financialYearId,
      salesType,
      invoiceNo: { $regex: `^${prefix.replace(/\//g, "\\/")}` },
    },
    { invoiceNo: 1 },
    { sort: { createdAt: -1 } }
  );

  if (!last) return `${prefix}01`;

  const lastNo = parseInt(last.invoiceNo.split("/").pop(), 10) || 0;
  return `${prefix}${String(lastNo + 1).padStart(2, "0")}`;
};

const customerSnapshotFromCustomer = (customer) => ({
  name: customer.name,
  gstin: customer.gstin || "",
  place: customer.address?.place || "",
  state: customer.address?.state || "",
  stateCode: customer.address?.stateCode || "",
  address: [customer.address?.line1, customer.address?.place, customer.address?.city]
    .filter(Boolean)
    .join(", "),
});

const resolveCustomerSnapshot = (invoice) => {
  if (invoice.customerSnapshot?.name) return invoice.customerSnapshot;
  const customer =
    invoice.customerId && typeof invoice.customerId === "object" ? invoice.customerId : null;
  return customer ? customerSnapshotFromCustomer(customer) : invoice.customerSnapshot ?? {};
};

// ── Create Sales Invoice ──────────────────────────────────────
export const createSalesInvoice = async ({
  companyId,
  branchId,
  financialYearId,
  warehouseId,
  invoiceDate,
  salesType,
  priceLevelId,
  customerId,
  items,
  notes,
}) => {
  const customer = await Customer.findOne({
    _id: customerId,
    companyId,
    type: "sales",
    customerType: salesType,
    isActive: true,
  });
  if (!customer) {
    throw new ApiError(404, `Customer not found. Must be a ${salesType} customer.`);
  }

  const priceLevel = await PriceLevel.findOne({
    _id: priceLevelId,
    companyId,
    isActive: true,
  });
  if (!priceLevel) throw new ApiError(404, "Price level not found");

  const itemIds = items.map((i) => i.itemId);
  const dbItems = await Item.find({
    _id: { $in: itemIds },
    companyId,
    isActive: true,
  }).populate("uomId", "name shortCode");
  if (dbItems.length !== itemIds.length) {
    throw new ApiError(400, "One or more items not found");
  }

  const invoiceNo = await generateSalesInvoiceNo(companyId, financialYearId, salesType);

  const SGST_RATE = 9;
  const CGST_RATE = 9;

  let netAmount = 0;
  let totalSGST = 0;
  let totalCGST = 0;

  const processedItems = items.map((row, index) => {
    const dbItem = dbItems.find((d) => String(d._id) === String(row.itemId));

    const baseRate = dbItem.price;
    const priceLevelPct = priceLevel.taxPercent;
    const rate = Number((baseRate + (baseRate * priceLevelPct / 100)).toFixed(2));

    const discount = Number(row.discount) || 0;
    const grossAmt = Number((rate * row.qty).toFixed(2));
    const discountAmt = Number((grossAmt * discount / 100).toFixed(2));
    const taxableValue = Number((grossAmt - discountAmt).toFixed(2));

    const sgst = Number((taxableValue * SGST_RATE / 100).toFixed(2));
    const cgst = Number((taxableValue * CGST_RATE / 100).toFixed(2));
    const total = Number((taxableValue + sgst + cgst).toFixed(2));

    netAmount += taxableValue;
    totalSGST += sgst;
    totalCGST += cgst;

    return {
      slNo: index + 1,
      itemId: row.itemId,
      hsn: row.hsn || dbItem.hsn || "",
      uomId: dbItem.uomId._id,
      baseRate,
      priceLevelPct,
      rate,
      qty: row.qty,
      discount,
      discountAmt,
      taxableValue,
      sgst,
      cgst,
      total,
    };
  });

  const totalTax = Number((totalSGST + totalCGST).toFixed(2));
  const total = Number((netAmount + totalTax).toFixed(2));
  const grandTotal = Math.round(total);
  const roundOff = Number((grandTotal - total).toFixed(2));

  const customerSnapshot = {
    name: customer.name,
    gstin: customer.gstin || "",
    place: customer.address?.place || "",
    state: customer.address?.state || "",
    stateCode: customer.address?.stateCode || "",
    address: [customer.address?.line1, customer.address?.place, customer.address?.city]
      .filter(Boolean)
      .join(", "),
  };

  const priceLevelSnapshot = {
    name: priceLevel.name,
    taxPercent: priceLevel.taxPercent,
  };

  return withTransaction(async (session) => {
    const [invoice] = await SalesInvoice.create(
      [{
        companyId,
        branchId,
        financialYearId,
        warehouseId,
        invoiceNo,
        invoiceDate: new Date(invoiceDate),
        salesType,
        priceLevelId,
        priceLevelSnapshot,
        customerId,
        customerSnapshot,
        items: processedItems,
        netAmount: Number(netAmount.toFixed(2)),
        totalSGST: Number(totalSGST.toFixed(2)),
        totalCGST: Number(totalCGST.toFixed(2)),
        totalTax,
        total,
        roundOff,
        grandTotal,
        paidAmount: 0,
        balanceAmount: grandTotal,
        paymentStatus: "pending",
        status: "confirmed",
        notes,
      }],
      sessionOpts(session)
    );

    for (const row of processedItems) {
      await moveStock({
        companyId,
        branchId,
        financialYearId,
        warehouseId,
        itemId: row.itemId,
        uomId: row.uomId,
        movementType: "sales_out",
        qty: row.qty,
        rate: row.rate,
        referenceType: "SalesInvoice",
        referenceId: invoice._id,
        referenceNo: invoiceNo,
      }, session);
    }

    return invoice;
  });
};

// ── Get all sales invoices ────────────────────────────────────
export const getAllSalesInvoices = async ({
  companyId, branchId, financialYearId,
  page = 1, limit = 20, search = "", salesType,
}) => {
  const filter = { companyId, branchId, financialYearId, isActive: true };
  if (search)    filter.invoiceNo = { $regex: search, $options: "i" };
  if (salesType) filter.salesType = salesType;

  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    SalesInvoice.find(filter)
      .populate("customerId",   "name phone")
      .populate("warehouseId",  "name code")
      .populate("priceLevelId", "name taxPercent")
      .select("invoiceNo invoiceDate salesType customerId customerSnapshot warehouseId priceLevelSnapshot grandTotal paidAmount balanceAmount paymentStatus status createdAt")
      .sort({ invoiceDate: -1 })
      .skip(skip).limit(limit).lean(),
    SalesInvoice.countDocuments(filter),
  ]);

  const enriched = data.map((inv) => ({
    ...inv,
    customerSnapshot: resolveCustomerSnapshot(inv),
  }));

  return {
    data: enriched,
    total,
    page:       Number(page),
    totalPages: Math.ceil(total / limit),
    hasNext:    page < Math.ceil(total / limit),
  };
};

// ── Get one sales invoice ─────────────────────────────────────
export const getOneSalesInvoice = async (companyId, invoiceId) => {
  const invoice = await SalesInvoice.findOne({ _id: invoiceId, companyId })
    .populate("customerId",    "name phone gstin address")
    .populate("warehouseId",   "name code")
    .populate("priceLevelId",  "name taxPercent")
    .populate("items.itemId",  "name code hsn")
    .populate("items.uomId",   "name shortCode")
    .lean();
  if (!invoice) throw new ApiError(404, "Sales invoice not found");
  return {
    ...invoice,
    customerSnapshot: resolveCustomerSnapshot(invoice),
  };
};