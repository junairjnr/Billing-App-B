import SalesReturn from "./salesReturn.model.js";
import SalesInvoice from "../salesInvoice/salesInvoice.model.js";
import FinancialYear from "../../financialYear/financialYear.model.js";
import Company from "../../company/company.model.js";
import { moveStock } from "../../stock/stock.services.js";
import ApiError from "../../../utils/ApiError.js";
import { withTransaction, sessionOpts } from "../../../utils/withTransaction.js";

const recalcPaymentStatus = (invoice) => {
  const effectiveTotal = Math.max(
    0,
    Number(invoice.grandTotal || 0) - Number(invoice.returnedAmount || 0)
  );
  const paid = Number(invoice.paidAmount || 0);
  invoice.balanceAmount = Math.max(0, Number((effectiveTotal - paid).toFixed(2)));

  if (paid <= 0) invoice.paymentStatus = "pending";
  else if (paid >= effectiveTotal - 0.009) invoice.paymentStatus = "paid";
  else invoice.paymentStatus = "partial";
};

const generateSalesReturnNo = async (companyId, financialYearId, salesType) => {
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
  const prefix = `${companyCode}/${typeCode}/${fy.label}/`;

  const last = await SalesReturn.findOne(
    {
      companyId,
      financialYearId,
      salesType,
      returnNo: { $regex: `^${prefix.replace(/\//g, "\\/")}` },
    },
    { returnNo: 1 },
    { sort: { createdAt: -1 } }
  );

  if (!last) return `${prefix}01`;

  const lastNo = parseInt(last.returnNo.split("/").pop(), 10) || 0;
  return `${prefix}${String(lastNo + 1).padStart(2, "0")}`;
};

const getReturnedQtyByLine = async (salesInvoiceId) => {
  const returns = await SalesReturn.find({
    salesInvoiceId,
    isActive: true,
    status: "confirmed",
  }).select("items");

  const map = {};
  for (const ret of returns) {
    for (const row of ret.items) {
      const key = String(row.invoiceItemId);
      map[key] = (map[key] || 0) + row.qty;
    }
  }
  return map;
};

const findInvoiceLine = (invoice, { slNo, itemId, invoiceItemId }) => {
  if (invoiceItemId) {
    return invoice.items.id(invoiceItemId);
  }
  if (slNo != null) {
    return invoice.items.find((row) => row.slNo === Number(slNo));
  }
  const matches = invoice.items.filter((row) => String(row.itemId) === String(itemId));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new ApiError(
      400,
      `Item ${itemId} appears on multiple lines. Send slNo or invoiceItemId.`
    );
  }
  return null;
};

const buildSalesReturnLine = (invoiceLine, qty) => {
  const ratio = qty / invoiceLine.qty;
  const discountAmt = Number((invoiceLine.discountAmt * ratio).toFixed(2));
  const taxableValue = Number((invoiceLine.taxableValue * ratio).toFixed(2));
  const sgst = Number((invoiceLine.sgst * ratio).toFixed(2));
  const cgst = Number((invoiceLine.cgst * ratio).toFixed(2));
  const total = Number((invoiceLine.total * ratio).toFixed(2));

  return {
    invoiceItemId: invoiceLine._id,
    itemId: invoiceLine.itemId,
    hsn: invoiceLine.hsn,
    uomId: invoiceLine.uomId,
    baseRate: invoiceLine.baseRate,
    priceLevelPct: invoiceLine.priceLevelPct,
    rate: invoiceLine.rate,
    qty,
    discount: invoiceLine.discount,
    discountAmt,
    taxableValue,
    sgst,
    cgst,
    total,
  };
};

export const getReturnableItems = async (companyId, salesInvoiceId) => {
  const invoice = await SalesInvoice.findOne({
    _id: salesInvoiceId,
    companyId,
    isActive: true,
    status: "confirmed",
  }).lean();

  if (!invoice) throw new ApiError(404, "Sales invoice not found");

  const returnedMap = await getReturnedQtyByLine(salesInvoiceId);

  const items = invoice.items.map((row) => {
    const returnedQty = returnedMap[String(row._id)] || 0;
    const returnableQty = Number((row.qty - returnedQty).toFixed(3));
    return {
      invoiceItemId: row._id,
      slNo: row.slNo,
      itemId: row.itemId,
      hsn: row.hsn,
      uomId: row.uomId,
      rate: row.rate,
      discount: row.discount,
      originalQty: row.qty,
      returnedQty,
      returnableQty: Math.max(0, returnableQty),
    };
  });

  return {
    salesInvoiceId: invoice._id,
    invoiceNo: invoice.invoiceNo,
    salesType: invoice.salesType,
    customerId: invoice.customerId,
    warehouseId: invoice.warehouseId,
    grandTotal: invoice.grandTotal,
    returnedAmount: invoice.returnedAmount || 0,
    items,
  };
};

export const createSalesReturn = async ({
  companyId,
  branchId,
  financialYearId,
  salesInvoiceId,
  returnDate,
  items,
  notes,
}) => {
  const invoice = await SalesInvoice.findOne({
    _id: salesInvoiceId,
    companyId,
    branchId,
    financialYearId,
    isActive: true,
    status: "confirmed",
  });

  if (!invoice) throw new ApiError(404, "Sales invoice not found");

  if (!items?.length) throw new ApiError(400, "At least one return item is required");

  const returnedMap = await getReturnedQtyByLine(salesInvoiceId);
  const processedItems = [];
  let netAmount = 0;
  let totalSGST = 0;
  let totalCGST = 0;

  for (const row of items) {
    const qty = Number(row.qty);
    if (!qty || qty <= 0) continue;

    const invoiceLine = findInvoiceLine(invoice, row);
    if (!invoiceLine) {
      throw new ApiError(404, `Invoice line not found for item ${row.itemId ?? row.invoiceItemId}`);
    }

    const alreadyReturned = returnedMap[String(invoiceLine._id)] || 0;
    const returnableQty = invoiceLine.qty - alreadyReturned;

    if (qty > returnableQty + 0.0001) {
      throw new ApiError(
        400,
        `Return qty ${qty} exceeds returnable qty ${Math.max(0, returnableQty)} for line ${invoiceLine.slNo}`
      );
    }

    const built = buildSalesReturnLine(invoiceLine, qty);
    processedItems.push(built);
    netAmount += built.taxableValue;
    totalSGST += built.sgst;
    totalCGST += built.cgst;
  }

  if (!processedItems.length) {
    throw new ApiError(400, "No valid return quantities provided");
  }

  const totalTax = Number((totalSGST + totalCGST).toFixed(2));
  const total = Number((netAmount + totalTax).toFixed(2));
  const grandTotal = Math.round(total);
  const roundOff = Number((grandTotal - total).toFixed(2));
  const returnNo = await generateSalesReturnNo(companyId, financialYearId, invoice.salesType);

  return withTransaction(async (session) => {
    const [salesReturn] = await SalesReturn.create(
      [{
        companyId,
        branchId,
        financialYearId,
        warehouseId: invoice.warehouseId,
        returnNo,
        returnDate: new Date(returnDate),
        salesInvoiceId: invoice._id,
        originalInvoiceNo: invoice.invoiceNo,
        salesType: invoice.salesType,
        priceLevelId: invoice.priceLevelId,
        priceLevelSnapshot: invoice.priceLevelSnapshot,
        customerId: invoice.customerId,
        customerSnapshot: invoice.customerSnapshot,
        items: processedItems.map((row, index) => ({ ...row, slNo: index + 1 })),
        netAmount: Number(netAmount.toFixed(2)),
        totalSGST: Number(totalSGST.toFixed(2)),
        totalCGST: Number(totalCGST.toFixed(2)),
        totalTax,
        total,
        roundOff,
        grandTotal,
        status: "confirmed",
        notes,
      }],
      sessionOpts(session)
    );

    invoice.returnedAmount = Number(((invoice.returnedAmount || 0) + grandTotal).toFixed(2));
    recalcPaymentStatus(invoice);
    await invoice.save(sessionOpts(session));

    for (const row of processedItems) {
      await moveStock(
        {
          companyId,
          branchId,
          financialYearId,
          warehouseId: invoice.warehouseId,
          itemId: row.itemId,
          uomId: row.uomId,
          movementType: "sales_return",
          qty: row.qty,
          rate: row.rate,
          referenceType: "SalesReturn",
          referenceId: salesReturn._id,
          referenceNo: returnNo,
        },
        session
      );
    }

    return salesReturn;
  });
};

export const getAllSalesReturns = async ({
  companyId,
  branchId,
  financialYearId,
  page = 1,
  limit = 20,
  search = "",
  salesType,
  salesInvoiceId,
}) => {
  const filter = { companyId, branchId, financialYearId, isActive: true };
  if (search) filter.returnNo = { $regex: search, $options: "i" };
  if (salesType) filter.salesType = salesType;
  if (salesInvoiceId) filter.salesInvoiceId = salesInvoiceId;

  const skip = (Number(page) - 1) * Number(limit);
  const [data, total] = await Promise.all([
    SalesReturn.find(filter)
      .populate("customerId", "name phone")
      .populate("warehouseId", "name code")
      .populate("salesInvoiceId", "invoiceNo invoiceDate")
      .select(
        "returnNo returnDate salesInvoiceId originalInvoiceNo salesType customerId customerSnapshot warehouseId grandTotal status createdAt"
      )
      .sort({ returnDate: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    SalesReturn.countDocuments(filter),
  ]);

  return {
    data,
    total,
    page: Number(page),
    totalPages: Math.ceil(total / Number(limit)),
    hasNext: Number(page) < Math.ceil(total / Number(limit)),
  };
};

export const getOneSalesReturn = async (companyId, returnId) => {
  const salesReturn = await SalesReturn.findOne({ _id: returnId, companyId, isActive: true })
    .populate("customerId", "name phone gstin address")
    .populate("warehouseId", "name code")
    .populate("salesInvoiceId", "invoiceNo invoiceDate grandTotal returnedAmount")
    .populate("items.itemId", "name code hsn")
    .populate("items.uomId", "name shortCode")
    .lean();

  if (!salesReturn) throw new ApiError(404, "Sales return not found");
  return salesReturn;
};
