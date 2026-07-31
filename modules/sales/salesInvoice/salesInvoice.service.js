import mongoose      from "mongoose";
import SalesInvoice  from "./salesInvoice.model.js";
import Customer      from "../../masters/customer/customer.model.js";
import Item          from "../../masters/item/item.model.js";
import PriceLevel    from "../../masters/priceLevel/priceLevel.model.js";
import FinancialYear from "../../financialYear/financialYear.model.js";
import { moveStock } from "../../stock/stock.services.js";
import ApiError      from "../../../utils/ApiError.js";

// ── FY short code: "2025-26" → "2526" ────────────────────────
const getFYCode = (label) => {
  const parts = label.split("-");
  return parts[0].slice(2) + parts[1];
};

// ── Generate sales invoice number based on type + FY ─────────
// retail    → SINV-R-2526-0001
// wholesale → SINV-W-2526-0001
const generateSalesInvoiceNo = async (companyId, financialYearId, salesType) => {
  const fy = await FinancialYear.findById(financialYearId);
  if (!fy) throw new ApiError(404, "Financial year not found");

  const fyCode     = getFYCode(fy.label);
  const typeCode   = salesType === "retail" ? "R" : "W";
  const prefix     = `SINV-${typeCode}-${fyCode}`;

  // Find last invoice of this type in this FY
  const last = await SalesInvoice.findOne(
    { companyId, financialYearId, salesType },
    { invoiceNo: 1 },
    { sort: { createdAt: -1 } }
  );

  if (!last) return `${prefix}-0001`;

  const parts  = last.invoiceNo.split("-");
  const lastNo = parseInt(parts[parts.length - 1]) || 0;
  const nextNo = String(lastNo + 1).padStart(4, "0");
  return `${prefix}-${nextNo}`;
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
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1. Validate customer
    // Customer must be type=sales AND customerType matches salesType
    const customer = await Customer.findOne({
      _id:          customerId,
      companyId,
      type:         "sales",
      customerType: salesType,
      isActive:     true,
    });
    if (!customer)
      throw new ApiError(404, `Customer not found. Must be a ${salesType} customer.`);

    // 2. Validate price level
    const priceLevel = await PriceLevel.findOne({
      _id: priceLevelId, companyId, isActive: true,
    });
    if (!priceLevel) throw new ApiError(404, "Price level not found");

    // 3. Validate items
    const itemIds = items.map((i) => i.itemId);
    const dbItems = await Item.find({
      _id: { $in: itemIds }, companyId, isActive: true,
    }).populate("uomId", "name shortCode");
    if (dbItems.length !== itemIds.length)
      throw new ApiError(400, "One or more items not found");

    // 4. Generate invoice number
    const invoiceNo = await generateSalesInvoiceNo(companyId, financialYearId, salesType);

    // 5. Calculate amounts
    // SGST = 9% always, CGST = 9% always (fixed for sales)
    const SGST_RATE = 9;
    const CGST_RATE = 9;

    let netAmount = 0, totalSGST = 0, totalCGST = 0;

    const processedItems = items.map((row, index) => {
      const dbItem = dbItems.find((d) => String(d._id) === String(row.itemId));

      // rate = baseRate + (baseRate * priceLevelPct / 100)
      const baseRate      = dbItem.price;
      const priceLevelPct = priceLevel.taxPercent;
      const rate          = Number((baseRate + (baseRate * priceLevelPct / 100)).toFixed(2));

      // discount
      const discount    = Number(row.discount) || 0;
      const grossAmt    = Number((rate * row.qty).toFixed(2));
      const discountAmt = Number((grossAmt * discount / 100).toFixed(2));

      // taxable value
      const taxableValue = Number((grossAmt - discountAmt).toFixed(2));

      // GST — always 9% + 9%
      const sgst  = Number((taxableValue * SGST_RATE / 100).toFixed(2));
      const cgst  = Number((taxableValue * CGST_RATE / 100).toFixed(2));
      const total = Number((taxableValue + sgst + cgst).toFixed(2));

      netAmount  += taxableValue;
      totalSGST  += sgst;
      totalCGST  += cgst;

      return {
        slNo:          index + 1,
        itemId:        row.itemId,
        hsn:           row.hsn || dbItem.hsn || "",
        uomId:         dbItem.uomId._id,
        baseRate,
        priceLevelPct,
        rate,
        qty:           row.qty,
        discount,
        discountAmt,
        taxableValue,
        sgst,
        cgst,
        total,
      };
    });

    const totalTax   = Number((totalSGST + totalCGST).toFixed(2));
    const total      = Number((netAmount + totalTax).toFixed(2));
    const grandTotal = Math.round(total);
    const roundOff   = Number((grandTotal - total).toFixed(2));

    // 6. Snapshots
    const customerSnapshot = {
      name:      customer.name,
      gstin:     customer.gstin || "",
      place:     customer.address?.place || "",
      state:     customer.address?.state || "",
      stateCode: customer.address?.stateCode || "",
      address:   [customer.address?.line1, customer.address?.place, customer.address?.city]
                   .filter(Boolean).join(", "),
    };

    const priceLevelSnapshot = {
      name:       priceLevel.name,
      taxPercent: priceLevel.taxPercent,
    };

    // 7. Create invoice
    const [invoice] = await SalesInvoice.create([{
      companyId, branchId, financialYearId, warehouseId,
      invoiceNo, invoiceDate: new Date(invoiceDate),
      salesType, priceLevelId, priceLevelSnapshot,
      customerId, customerSnapshot,
      items:      processedItems,
      netAmount:  Number(netAmount.toFixed(2)),
      totalSGST:  Number(totalSGST.toFixed(2)),
      totalCGST:  Number(totalCGST.toFixed(2)),
      totalTax, total, roundOff, grandTotal,
      status: "confirmed", notes,
    }], { session });

    // 8. Move stock out
    for (const row of processedItems) {
      await moveStock({
        companyId, branchId, financialYearId, warehouseId,
        itemId:        row.itemId,
        uomId:         row.uomId,
        movementType:  "sales_out",
        qty:           row.qty,
        rate:          row.rate,
        referenceType: "SalesInvoice",
        referenceId:   invoice._id,
        referenceNo:   invoiceNo,
      }, session);
    }

    await session.commitTransaction();
    return invoice;

  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
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
      .select("invoiceNo invoiceDate salesType customerId customerSnapshot warehouseId priceLevelSnapshot grandTotal status createdAt")
      .sort({ invoiceDate: -1 })
      .skip(skip).limit(limit).lean(),
    SalesInvoice.countDocuments(filter),
  ]);

  return {
    data, total,
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
  return invoice;
};