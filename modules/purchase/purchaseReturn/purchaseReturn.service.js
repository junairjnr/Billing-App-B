import PurchaseReturn from "./purchaseReturn.model.js";
import PurchaseInvoice from "../purchaseInvoice/purchaseInvoice.model.js";
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

const generatePurchaseReturnNo = async (companyId, financialYearId) => {
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

  const prefix = `${companyCode}/PR/${fy.label}/`;

  const last = await PurchaseReturn.findOne(
    {
      companyId,
      financialYearId,
      returnNo: { $regex: `^${prefix.replace(/\//g, "\\/")}` },
    },
    { returnNo: 1 },
    { sort: { createdAt: -1 } }
  );

  if (!last) return `${prefix}01`;

  const lastNo = parseInt(last.returnNo.split("/").pop(), 10) || 0;
  return `${prefix}${String(lastNo + 1).padStart(2, "0")}`;
};

const getReturnedQtyByLine = async (purchaseInvoiceId) => {
  const returns = await PurchaseReturn.find({
    purchaseInvoiceId,
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

const buildPurchaseReturnLine = (invoiceLine, qty) => {
  const ratio = qty / invoiceLine.qty;
  const taxableValue = Number((invoiceLine.taxableValue * ratio).toFixed(2));
  const sgst = Number((invoiceLine.sgst * ratio).toFixed(2));
  const cgst = Number((invoiceLine.cgst * ratio).toFixed(2));
  const total = Number((invoiceLine.total * ratio).toFixed(2));

  return {
    invoiceItemId: invoiceLine._id,
    itemId: invoiceLine.itemId,
    hsn: invoiceLine.hsn,
    uomId: invoiceLine.uomId,
    rate: invoiceLine.rate,
    qty,
    taxPercent: invoiceLine.taxPercent,
    taxableValue,
    sgst,
    cgst,
    total,
  };
};

export const getReturnableItems = async (companyId, purchaseInvoiceId) => {
  const invoice = await PurchaseInvoice.findOne({
    _id: purchaseInvoiceId,
    companyId,
    isActive: true,
    status: "confirmed",
  }).lean();

  if (!invoice) throw new ApiError(404, "Purchase invoice not found");

  const returnedMap = await getReturnedQtyByLine(purchaseInvoiceId);

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
      originalQty: row.qty,
      returnedQty,
      returnableQty: Math.max(0, returnableQty),
    };
  });

  return {
    purchaseInvoiceId: invoice._id,
    invoiceNo: invoice.invoiceNo,
    vendorInvoiceNo: invoice.vendorInvoiceNo,
    vendorId: invoice.vendorId,
    warehouseId: invoice.warehouseId,
    grandTotal: invoice.grandTotal,
    returnedAmount: invoice.returnedAmount || 0,
    items,
  };
};

export const createPurchaseReturn = async ({
  companyId,
  branchId,
  financialYearId,
  purchaseInvoiceId,
  returnDate,
  items,
  notes,
}) => {
  const invoice = await PurchaseInvoice.findOne({
    _id: purchaseInvoiceId,
    companyId,
    branchId,
    financialYearId,
    isActive: true,
    status: "confirmed",
  });

  if (!invoice) throw new ApiError(404, "Purchase invoice not found");

  if (!items?.length) throw new ApiError(400, "At least one return item is required");

  const returnedMap = await getReturnedQtyByLine(purchaseInvoiceId);
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

    const built = buildPurchaseReturnLine(invoiceLine, qty);
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
  const returnNo = await generatePurchaseReturnNo(companyId, financialYearId);

  return withTransaction(async (session) => {
    const [purchaseReturn] = await PurchaseReturn.create(
      [{
        companyId,
        branchId,
        financialYearId,
        warehouseId: invoice.warehouseId,
        returnNo,
        returnDate: new Date(returnDate),
        purchaseInvoiceId: invoice._id,
        originalInvoiceNo: invoice.invoiceNo,
        vendorInvoiceNo: invoice.vendorInvoiceNo,
        vendorId: invoice.vendorId,
        vendorSnapshot: invoice.vendorSnapshot,
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
          movementType: "purchase_return",
          qty: row.qty,
          rate: row.rate,
          referenceType: "PurchaseReturn",
          referenceId: purchaseReturn._id,
          referenceNo: returnNo,
        },
        session
      );
    }

    return purchaseReturn;
  });
};

export const getAllPurchaseReturns = async ({
  companyId,
  branchId,
  financialYearId,
  page = 1,
  limit = 20,
  search = "",
  purchaseInvoiceId,
}) => {
  const filter = { companyId, branchId, financialYearId, isActive: true };
  if (search) filter.returnNo = { $regex: search, $options: "i" };
  if (purchaseInvoiceId) filter.purchaseInvoiceId = purchaseInvoiceId;

  const skip = (Number(page) - 1) * Number(limit);
  const [data, total] = await Promise.all([
    PurchaseReturn.find(filter)
      .populate("vendorId", "name phone")
      .populate("warehouseId", "name code")
      .populate("purchaseInvoiceId", "invoiceNo vendorInvoiceNo purchaseDate")
      .select(
        "returnNo returnDate purchaseInvoiceId originalInvoiceNo vendorInvoiceNo vendorId vendorSnapshot warehouseId grandTotal status createdAt"
      )
      .sort({ returnDate: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    PurchaseReturn.countDocuments(filter),
  ]);

  return {
    data,
    total,
    page: Number(page),
    totalPages: Math.ceil(total / Number(limit)),
    hasNext: Number(page) < Math.ceil(total / Number(limit)),
  };
};

export const getOnePurchaseReturn = async (companyId, returnId) => {
  const purchaseReturn = await PurchaseReturn.findOne({ _id: returnId, companyId, isActive: true })
    .populate("vendorId", "name phone gstin address")
    .populate("warehouseId", "name code")
    .populate("purchaseInvoiceId", "invoiceNo vendorInvoiceNo purchaseDate grandTotal returnedAmount")
    .populate("items.itemId", "name code hsn")
    .populate("items.uomId", "name shortCode")
    .lean();

  if (!purchaseReturn) throw new ApiError(404, "Purchase return not found");
  return purchaseReturn;
};
