// import mongoose        from "mongoose";
// import PurchaseInvoice from "./purchaseInvoice.model.js";
// import Customer        from "../../masters/customer/customer.model.js";
// import Item            from "../../masters/item/item.model.js";
// import { moveStock }   from "../../stock/stock.services.js";
// import ApiError        from "../../../utils/ApiError.js";

// // ── Auto generate invoice number ──────────────────────────────
// const generateInvoiceNo = async (companyId, financialYearId) => {
//   const last = await PurchaseInvoice.findOne(
//     { companyId, financialYearId },
//     { invoiceNo: 1 },
//     { sort: { createdAt: -1 } }
//   );

//   if (!last) return "PINV-0001";

//   const lastNo = parseInt(last.invoiceNo.split("-")[1]) || 0;
//   const nextNo = String(lastNo + 1).padStart(4, "0");
//   return `PINV-${nextNo}`;
// };

// // ── Create Purchase Invoice ───────────────────────────────────
// export const createPurchaseInvoice = async ({
//   companyId,
//   branchId,
//   financialYearId,
//   warehouseId,
//   vendorId,
//   vendorInvoiceNo,
//   purchaseDate,
//   items,
//   notes,
// }) => {
//   const session = await mongoose.startSession();
//   session.startTransaction();

//   try {
//     // 1. Validate vendor — must be purchase type
//     const vendor = await Customer.findOne({
//       _id:       vendorId,
//       companyId,
//       type:      "purchase",
//       isActive:  true,
//     });
//     if (!vendor) throw new ApiError(404, "Vendor not found or invalid");

//     // 2. Validate all items exist
//     const itemIds = items.map((i) => i.itemId);
//     const dbItems = await Item.find({
//       _id:       { $in: itemIds },
//       companyId,
//       isActive:  true,
//     }).populate("uomId", "name shortCode");

//     if (dbItems.length !== itemIds.length) {
//       throw new ApiError(400, "One or more items not found");
//     }

//     // 3. Generate invoice number
//     const invoiceNo = await generateInvoiceNo(companyId, financialYearId);

//     // 4. Calculate all amounts
//     let netAmount  = 0;
//     let totalSGST  = 0;
//     let totalCGST  = 0;

//     const processedItems = items.map((row, index) => {
//       const dbItem      = dbItems.find((d) => String(d._id) === String(row.itemId));
//       const taxableValue = Number((row.qty * row.rate).toFixed(2));
//       const taxPercent   = dbItem.taxPercent || 0;
//       const sgst         = Number((taxableValue * taxPercent / 200).toFixed(2));
//       const cgst         = Number((taxableValue * taxPercent / 200).toFixed(2));
//       const total        = Number((taxableValue + sgst + cgst).toFixed(2));

//       netAmount  += taxableValue;
//       totalSGST  += sgst;
//       totalCGST  += cgst;

//       return {
//         slNo:         index + 1,
//         itemId:       row.itemId,
//         hsn:          row.hsn || dbItem.hsn || "",
//         uomId:        dbItem.uomId._id,
//         rate:         row.rate,
//         qty:          row.qty,
//         taxableValue,
//         taxPercent,
//         sgst,
//         cgst,
//         total,
//       };
//     });

//     const totalTax   = Number((totalSGST + totalCGST).toFixed(2));
//     const total      = Number((netAmount + totalTax).toFixed(2));
//     const grandTotal = Math.round(total);
//     const roundOff   = Number((grandTotal - total).toFixed(2));

//     // 5. Vendor snapshot — save details at time of purchase
//     const vendorSnapshot = {
//       name:      vendor.name,
//       gstin:     vendor.gstin     || "",
//       place:     vendor.address?.place     || "",
//       state:     vendor.address?.state     || "",
//       stateCode: vendor.address?.stateCode || "",
//       address:   [
//         vendor.address?.line1,
//         vendor.address?.place,
//         vendor.address?.city,
//         vendor.address?.state,
//       ].filter(Boolean).join(", "),
//     };

//     // 6. Create invoice
//     const [invoice] = await PurchaseInvoice.create(
//       [{
//         companyId,
//         branchId,
//         financialYearId,
//         warehouseId,
//         invoiceNo,
//         vendorInvoiceNo,
//         purchaseDate:    new Date(purchaseDate),
//         vendorId,
//         vendorSnapshot,
//         items:           processedItems,
//         netAmount:       Number(netAmount.toFixed(2)),
//         totalSGST:       Number(totalSGST.toFixed(2)),
//         totalCGST:       Number(totalCGST.toFixed(2)),
//         totalTax,
//         total,
//         roundOff,
//         grandTotal,
//         status:          "confirmed",
//         notes,
//       }],
//       { session }
//     );

//     // 7. Move stock — one call per item
//     for (const row of processedItems) {
//       const dbItem = dbItems.find((d) => String(d._id) === String(row.itemId));
//       await moveStock(
//         {
//           companyId,
//           branchId,
//           financialYearId,
//           warehouseId,
//           itemId:        row.itemId,
//           uomId:         row.uomId,
//           movementType:  "purchase_in",
//           qty:           row.qty,
//           rate:          row.rate,
//           referenceType: "PurchaseInvoice",
//           referenceId:   invoice._id,
//           referenceNo:   invoiceNo,
//         },
//         session
//       );
//     }

//     await session.commitTransaction();

//     return invoice;

//   } catch (err) {
//     await session.abortTransaction();
//     throw err;
//   } finally {
//     session.endSession();
//   }
// };

// // ── Get all purchase invoices ─────────────────────────────────
// export const getAllPurchaseInvoices = async ({
//   companyId,
//   branchId,
//   financialYearId,
//   page  = 1,
//   limit = 20,
//   search = "",
// }) => {
//   const filter = { companyId, branchId, financialYearId, isActive: true };
//   if (search) filter.invoiceNo = { $regex: search, $options: "i" };

//   const skip = (page - 1) * limit;

//   const [data, total] = await Promise.all([
//     PurchaseInvoice.find(filter)
//       .populate("vendorId",    "name phone")
//       .populate("warehouseId", "name code")
//       .select("invoiceNo vendorInvoiceNo purchaseDate vendorId vendorSnapshot warehouseId grandTotal status createdAt")
//       .sort({ purchaseDate: -1 })
//       .skip(skip)
//       .limit(limit)
//       .lean(),
//     PurchaseInvoice.countDocuments(filter),
//   ]);

//   return {
//     data,
//     total,
//     page:       Number(page),
//     totalPages: Math.ceil(total / limit),
//     hasNext:    page < Math.ceil(total / limit),
//   };
// };

// // ── Get one purchase invoice ──────────────────────────────────
// export const getOnePurchaseInvoice = async (companyId, invoiceId) => {
//   const invoice = await PurchaseInvoice.findOne({ _id: invoiceId, companyId })
//     .populate("vendorId",        "name phone gstin address")
//     .populate("warehouseId",     "name code")
//     .populate("items.itemId",    "name code hsn")
//     .populate("items.uomId",     "name shortCode")
//     .lean();

//   if (!invoice) throw new ApiError(404, "Purchase invoice not found");
//   return invoice;
// };

import mongoose        from "mongoose";
import PurchaseInvoice from "./purchaseInvoice.model.js";
import Customer        from "../../masters/customer/customer.model.js";
import Item            from "../../masters/item/item.model.js";
import { moveStock }   from "../../stock/stock.services.js";
import ApiError        from "../../../utils/ApiError.js";
import FinancialYear   from "../../financialYear/financialYear.model.js";

// ── Generate FY short code from label ────────────────────────
// "2025-26" → "2526"
const getFYCode = (label) => {
  const parts = label.split("-");
  return parts[0].slice(2) + parts[1]; // "25" + "26" = "2526"
};

// ── FY-based purchase invoice number ─────────────────────────
const generatePurchaseInvoiceNo = async (companyId, financialYearId) => {
  const fy = await FinancialYear.findById(financialYearId);
  if (!fy) throw new ApiError(404, "Financial year not found");

  const fyCode = getFYCode(fy.label); // "2526"
  const prefix = `PINV-${fyCode}`;

  const last = await PurchaseInvoice.findOne(
    { companyId, financialYearId },
    { invoiceNo: 1 },
    { sort: { createdAt: -1 } }
  );

  if (!last) return `${prefix}-0001`;

  const parts  = last.invoiceNo.split("-");
  const lastNo = parseInt(parts[parts.length - 1]) || 0;
  const nextNo = String(lastNo + 1).padStart(4, "0");
  return `${prefix}-${nextNo}`;
};

// ── Create Purchase Invoice ───────────────────────────────────
export const createPurchaseInvoice = async ({
  companyId,
  branchId,
  financialYearId,
  warehouseId,
  vendorId,
  vendorInvoiceNo,
  purchaseDate,
  items,
  notes,
}) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1. Validate vendor
    const vendor = await Customer.findOne({
      _id: vendorId, companyId, type: "purchase", isActive: true,
    });
    if (!vendor) throw new ApiError(404, "Vendor not found or invalid");

    // 2. Validate items
    const itemIds = items.map((i) => i.itemId);
    const dbItems = await Item.find({
      _id: { $in: itemIds }, companyId, isActive: true,
    }).populate("uomId", "name shortCode");
    if (dbItems.length !== itemIds.length)
      throw new ApiError(400, "One or more items not found");

    // 3. Check for duplicate vendorInvoiceNo (within same company + vendor + financial year)
    if (vendorInvoiceNo && vendorInvoiceNo.trim() !== "") {
      const duplicate = await PurchaseInvoice.findOne({
        companyId,
        financialYearId,
        vendorId,
        vendorInvoiceNo: vendorInvoiceNo.trim(),
      }).lean();
      if (duplicate) {
        throw new ApiError(
          409,
          `Vendor invoice number "${vendorInvoiceNo.trim()}" already exists for this vendor in the current financial year (Ref: ${duplicate.invoiceNo})`
        );
      }
    }

    // 4. Generate invoice number
    const invoiceNo = await generatePurchaseInvoiceNo(companyId, financialYearId);

    // 5. Calculate amounts
    let netAmount = 0, totalSGST = 0, totalCGST = 0;

    const processedItems = items.map((row, index) => {
      const dbItem      = dbItems.find((d) => String(d._id) === String(row.itemId));
      const taxableValue = Number((row.qty * row.rate).toFixed(2));
      const taxPercent   = dbItem.taxPercent || 0;
      const sgst         = Number((taxableValue * taxPercent / 200).toFixed(2));
      const cgst         = Number((taxableValue * taxPercent / 200).toFixed(2));
      const total        = Number((taxableValue + sgst + cgst).toFixed(2));

      netAmount  += taxableValue;
      totalSGST  += sgst;
      totalCGST  += cgst;

      return {
        slNo: index + 1,
        itemId: row.itemId,
        hsn:   row.hsn || dbItem.hsn || "",
        uomId: dbItem.uomId._id,
        rate:  row.rate,
        qty:   row.qty,
        taxableValue,
        taxPercent,
        sgst,
        cgst,
        total,
      };
    });

    const totalTax   = Number((totalSGST + totalCGST).toFixed(2));
    const total      = Number((netAmount + totalTax).toFixed(2));
    const grandTotal = Math.round(total);
    const roundOff   = Number((grandTotal - total).toFixed(2));

    // 5. Vendor snapshot
    const vendorSnapshot = {
      name:      vendor.name,
      gstin:     vendor.gstin || "",
      place:     vendor.address?.place || "",
      state:     vendor.address?.state || "",
      stateCode: vendor.address?.stateCode || "",
      address:   [vendor.address?.line1, vendor.address?.place, vendor.address?.city]
                   .filter(Boolean).join(", "),
    };

    // 6. Create invoice
    const [invoice] = await PurchaseInvoice.create([{
      companyId, branchId, financialYearId, warehouseId,
      invoiceNo, vendorInvoiceNo,
      purchaseDate: new Date(purchaseDate),
      vendorId, vendorSnapshot,
      items: processedItems,
      netAmount: Number(netAmount.toFixed(2)),
      totalSGST: Number(totalSGST.toFixed(2)),
      totalCGST: Number(totalCGST.toFixed(2)),
      totalTax, total, roundOff, grandTotal,
      paidAmount: 0,
      balanceAmount: grandTotal,
      paymentStatus: "pending",
      status: "confirmed", notes,
    }], { session });

    // 7. Move stock
    for (const row of processedItems) {
      await moveStock({
        companyId, branchId, financialYearId, warehouseId,
        itemId:        row.itemId,
        uomId:         row.uomId,
        movementType:  "purchase_in",
        qty:           row.qty,
        rate:          row.rate,
        referenceType: "PurchaseInvoice",
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

export const getAllPurchaseInvoices = async ({
  companyId, branchId, financialYearId, page = 1, limit = 20, search = "",
}) => {
  const filter = { companyId, branchId, financialYearId, isActive: true };
  if (search) filter.invoiceNo = { $regex: search, $options: "i" };

  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    PurchaseInvoice.find(filter)
      .populate("vendorId",    "name phone")
      .populate("warehouseId", "name code")
      .select("invoiceNo vendorInvoiceNo purchaseDate vendorId vendorSnapshot warehouseId grandTotal status createdAt")
      .sort({ purchaseDate: -1 })
      .skip(skip).limit(limit).lean(),
    PurchaseInvoice.countDocuments(filter),
  ]);

  return { data, total, page: Number(page), totalPages: Math.ceil(total / limit), hasNext: page < Math.ceil(total / limit) };
};

export const getOnePurchaseInvoice = async (companyId, invoiceId) => {
  const invoice = await PurchaseInvoice.findOne({ _id: invoiceId, companyId })
    .populate("vendorId",     "name phone gstin address")
    .populate("warehouseId",  "name code")
    .populate("items.itemId", "name code hsn")
    .populate("items.uomId",  "name shortCode")
    .lean();
  if (!invoice) throw new ApiError(404, "Purchase invoice not found");
  return invoice;
};