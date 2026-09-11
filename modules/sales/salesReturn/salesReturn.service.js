import mongoose from "mongoose";
import SalesReturn from "./salesReturn.model.js";
import SalesInvoice from "../salesInvoice/salesInvoice.model.js";
import Customer from "../../masters/customer/customer.model.js";
import { salesCustomerTypeFilter } from "../../masters/customer/customer.service.js";
import Item from "../../masters/item/item.model.js";
import PriceLevel from "../../masters/priceLevel/priceLevel.model.js";
import Warehouse from "../../warehouse/warehouse.model.js";
import Branch from "../../branch/branch.model.js";
import { moveStock } from "../../stock/stock.services.js";
import ApiError from "../../../utils/ApiError.js";
import { withTransaction, sessionOpts } from "../../../utils/withTransaction.js";
import { getNextSalesReturnNo } from "../../documentNumber/documentNumber.service.js";
import { regexContains } from "../../../utils/escapeRegex.js";
import { optionalSearchString } from "../../../utils/sanitizeInput.js";
import {
  calculateLineGst,
  DEFAULT_GST_PERCENT,
  resolvePartyStateCode,
} from "../../../utils/gstTax.js";

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
  })
    .populate("items.itemId", "name code hsnCode")
    .populate("items.uomId", "name shortCode")
    .lean();

  if (!invoice) throw new ApiError(404, "Sales invoice not found");

  const returnedMap = await getReturnedQtyByLine(salesInvoiceId);

  const items = invoice.items.map((row) => {
    const returnedQty = returnedMap[String(row._id)] || 0;
    const returnableQty = Number((row.qty - returnedQty).toFixed(3));
    const itemRef = row.itemId;
    const uomRef = row.uomId;
    return {
      invoiceItemId: row._id,
      slNo: row.slNo,
      itemId: typeof itemRef === "object" ? itemRef?._id : itemRef,
      itemName: typeof itemRef === "object" ? itemRef?.name || "" : "",
      itemCode: typeof itemRef === "object" ? itemRef?.code || "" : "",
      hsn: row.hsn || (typeof itemRef === "object" ? itemRef?.hsnCode : "") || "",
      uomId: typeof uomRef === "object" ? uomRef?._id : uomRef,
      uomShortCode:
        typeof uomRef === "object" ? uomRef?.shortCode || uomRef?.name || "" : "",
      baseRate: row.baseRate,
      priceLevelPct: row.priceLevelPct,
      rate: row.rate,
      discount: row.discount,
      discountAmt: row.discountAmt,
      taxableValue: row.taxableValue,
      sgst: row.sgst,
      cgst: row.cgst,
      igst: row.igst,
      total: row.total,
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

const buildManualSalesReturnLine = (
  dbItem,
  priceLevel,
  row,
  slNo,
  supplierStateCode,
  placeOfSupplyStateCode
) => {
  const qty = Number(row.qty);
  const discount = Number(row.discount) || 0;
  const priceLevelPct = priceLevel.taxPercent;
  const baseRate = Number(dbItem.price) || Number(row.baseRate) || 0;
  const rate = Number((baseRate + (baseRate * priceLevelPct) / 100).toFixed(2));
  const taxPercent = Number(dbItem.taxPercent) || DEFAULT_GST_PERCENT;
  const grossAmt = Number((rate * qty).toFixed(2));
  const discountAmt = Number(((grossAmt * discount) / 100).toFixed(2));
  const taxableValue = Number((grossAmt - discountAmt).toFixed(2));
  const gst = calculateLineGst({
    taxableValue,
    taxPercent,
    supplierStateCode,
    placeOfSupplyStateCode,
  });
  const total = Number((taxableValue + gst.sgst + gst.cgst + gst.igst).toFixed(2));

  return {
    slNo,
    invoiceItemId: new mongoose.Types.ObjectId(),
    itemId: dbItem._id,
    hsn: row.hsn || dbItem.hsn || dbItem.hsnCode || "",
    uomId: dbItem.uomId?._id ?? dbItem.uomId,
    baseRate,
    priceLevelPct,
    rate,
    qty,
    discount,
    discountAmt,
    taxableValue,
    taxPercent,
    sgst: gst.sgst,
    cgst: gst.cgst,
    igst: gst.igst,
    total,
  };
};

const createManualSalesReturn = async ({
  companyId,
  branchId,
  financialYearId,
  returnDate,
  customerId,
  warehouseId,
  salesType,
  priceLevelId,
  referenceInvoiceNo,
  items,
  notes,
}) => {
  if (!customerId) throw new ApiError(400, "Customer is required for manual return");
  if (!warehouseId) throw new ApiError(400, "Warehouse is required for manual return");
  if (!salesType) throw new ApiError(400, "Sales type is required for manual return");
  if (!priceLevelId) throw new ApiError(400, "Price level is required for manual return");
  if (!items?.length) throw new ApiError(400, "At least one return item is required");

  const [customer, warehouse, priceLevel, branch] = await Promise.all([
    Customer.findOne({
      _id: customerId,
      companyId,
      type: "sales",
      isActive: true,
      ...salesCustomerTypeFilter(salesType),
    }),
    Warehouse.findOne({ _id: warehouseId, companyId, isActive: true }),
    PriceLevel.findOne({ _id: priceLevelId, companyId, isActive: true }),
    Branch.findOne({ _id: branchId, companyId }).select("address gstin"),
  ]);

  if (!customer) {
    throw new ApiError(404, `Customer not found. Must be a ${salesType} customer.`);
  }
  if (!warehouse) throw new ApiError(404, "Warehouse not found");
  if (!priceLevel) throw new ApiError(404, "Price level not found");

  const supplierStateCode = resolvePartyStateCode({
    gstin: branch?.gstin,
    address: branch?.address,
  });
  const placeOfSupplyStateCode = resolvePartyStateCode({
    gstin: customer.gstin,
    address: customer.address,
  });

  const itemIds = [...new Set(items.map((row) => String(row.itemId)).filter(Boolean))];
  const dbItems = await Item.find({ _id: { $in: itemIds }, companyId, isActive: true }).populate(
    "uomId",
    "name shortCode"
  );
  const itemMap = Object.fromEntries(dbItems.map((item) => [String(item._id), item]));

  const processedItems = [];
  let netAmount = 0;
  let totalSGST = 0;
  let totalCGST = 0;
  let totalIGST = 0;

  for (const row of items) {
    const qty = Number(row.qty);
    if (!row.itemId || !qty || qty <= 0) continue;

    const dbItem = itemMap[String(row.itemId)];
    if (!dbItem) throw new ApiError(404, `Item not found: ${row.itemId}`);

    const built = buildManualSalesReturnLine(
      dbItem,
      priceLevel,
      row,
      processedItems.length + 1,
      supplierStateCode,
      placeOfSupplyStateCode
    );
    if (!built.rate || built.rate <= 0) {
      throw new ApiError(400, "Rate is required for each manual return line");
    }

    processedItems.push(built);
    netAmount += built.taxableValue;
    totalSGST += built.sgst;
    totalCGST += built.cgst;
    totalIGST += built.igst;
  }

  if (!processedItems.length) {
    throw new ApiError(400, "No valid return quantities provided");
  }

  const totalTax = Number((totalSGST + totalCGST + totalIGST).toFixed(2));
  const total = Number((netAmount + totalTax).toFixed(2));
  const grandTotal = Math.round(total);
  const roundOff = Number((grandTotal - total).toFixed(2));
  const returnNo = await getNextSalesReturnNo(companyId, financialYearId, salesType);
  const originalInvoiceNo = referenceInvoiceNo?.trim() || "MANUAL";

  return withTransaction(async (session) => {
    const [salesReturn] = await SalesReturn.create(
      [
        {
          companyId,
          branchId,
          financialYearId,
          warehouseId,
          returnNo,
          returnDate: new Date(returnDate),
          returnMode: "manual",
          referenceInvoiceNo: referenceInvoiceNo?.trim() || "",
          originalInvoiceNo,
          salesType,
          priceLevelId,
          priceLevelSnapshot: { name: priceLevel.name, taxPercent: priceLevel.taxPercent },
          customerId,
          customerSnapshot: customerSnapshotFromCustomer(customer),
          items: processedItems,
          netAmount: Number(netAmount.toFixed(2)),
          totalSGST: Number(totalSGST.toFixed(2)),
          totalCGST: Number(totalCGST.toFixed(2)),
          totalTax,
          total,
          roundOff,
          grandTotal,
          status: "confirmed",
          notes,
        },
      ],
      sessionOpts(session)
    );

    for (const row of processedItems) {
      await moveStock(
        {
          companyId,
          branchId,
          financialYearId,
          warehouseId,
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

export const createSalesReturn = async (payload) => {
  const {
    companyId,
    branchId,
    financialYearId,
    salesInvoiceId,
    returnDate,
    items,
    notes,
    returnMode,
    customerId,
    warehouseId,
    salesType,
    priceLevelId,
    referenceInvoiceNo,
  } = payload;

  const isManual = returnMode === "manual" || !salesInvoiceId;

  if (isManual) {
    return createManualSalesReturn({
      companyId,
      branchId,
      financialYearId,
      returnDate,
      customerId,
      warehouseId,
      salesType,
      priceLevelId,
      referenceInvoiceNo,
      items,
      notes,
    });
  }

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
  const returnNo = await getNextSalesReturnNo(companyId, financialYearId, invoice.salesType);

  return withTransaction(async (session) => {
    const [salesReturn] = await SalesReturn.create(
      [{
        companyId,
        branchId,
        financialYearId,
        warehouseId: invoice.warehouseId,
        returnNo,
        returnDate: new Date(returnDate),
        returnMode: "invoice",
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
  const safeSearch = optionalSearchString(search);
  if (safeSearch) filter.returnNo = regexContains(safeSearch);
  if (salesType) filter.salesType = salesType;
  if (salesInvoiceId) filter.salesInvoiceId = salesInvoiceId;

  const skip = (Number(page) - 1) * Number(limit);
  const [data, total] = await Promise.all([
    SalesReturn.find(filter)
      .populate("customerId", "name phone")
      .populate("warehouseId", "name code")
      .populate("salesInvoiceId", "invoiceNo invoiceDate")
      .select(
        "returnNo returnDate returnMode salesInvoiceId originalInvoiceNo referenceInvoiceNo salesType customerId customerSnapshot warehouseId grandTotal status createdAt"
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
    .populate("items.itemId", "name code hsnCode")
    .populate("items.uomId", "name shortCode")
    .lean();

  if (!salesReturn) throw new ApiError(404, "Sales return not found");
  return salesReturn;
};
