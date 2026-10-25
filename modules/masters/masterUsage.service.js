import mongoose from "mongoose";
import ApiError from "../../utils/ApiError.js";
import itemModel from "./item/item.model.js";
import SalesInvoice from "../sales/salesInvoice/salesInvoice.model.js";
import SalesReturn from "../sales/salesReturn/salesReturn.model.js";
import PurchaseInvoice from "../purchase/purchaseInvoice/purchaseInvoice.model.js";
import PurchaseReturn from "../purchase/purchaseReturn/purchaseReturn.model.js";
import Stock from "../stock/stock.model.js";
import StockLedger from "../stock/stockLedger.model.js";
import ReceiptPayment from "../receipt-payment/receiptPayment.model.js";
import Expense from "../expense/expense.model.js";
import JournalEntry from "../accounting/journal/journalEntry.model.js";
import User from "../user/user.model.js";
import Warehouse from "../warehouse/warehouse.model.js";

const toObjectId = (id) => {
  if (!id) return null;
  if (id instanceof mongoose.Types.ObjectId) return id;
  if (!mongoose.Types.ObjectId.isValid(String(id))) return null;
  return new mongoose.Types.ObjectId(String(id));
};

const companyFilter = (companyId, extra = {}) => ({
  companyId: toObjectId(companyId),
  ...extra,
});

const confirmedBillingFilter = (companyId) =>
  companyFilter(companyId, { status: "confirmed", isActive: { $ne: false } });

const activeVoucherFilter = (companyId) =>
  companyFilter(companyId, {
    status: { $ne: "cancelled" },
    isActive: { $ne: false },
  });

const refIn = (field, id) => {
  const oid = toObjectId(id);
  const values = oid ? [oid, String(id)] : [String(id)];
  return { [field]: { $in: values } };
};

const throwInUse = (entityLabel) => {
  throw new ApiError(
    409,
    `Cannot delete this ${entityLabel} because it is linked to active transactions or records in the system.`
  );
};

export const assertCategoryNotInUse = async (companyId, categoryId) => {
  const oid = toObjectId(categoryId);
  if (!oid) throw new ApiError(400, "Invalid category id");

  const inProducts = await itemModel.exists(
    companyFilter(companyId, { categoryId: oid, isActive: { $ne: false } })
  );
  if (inProducts) {
    throw new ApiError(
      409,
      "Cannot delete this category because it is assigned to one or more products."
    );
  }
};

export const assertUomNotInUse = async (companyId, uomId) => {
  const oid = toObjectId(uomId);
  if (!oid) throw new ApiError(400, "Invalid unit id");

  const base = confirmedBillingFilter(companyId);
  const lineUom = { ...base, "items.uomId": oid };

  const [inProducts, inSales, inSalesRet, inPurchase, inPurchaseRet] =
    await Promise.all([
      itemModel.exists(companyFilter(companyId, { uomId: oid, isActive: { $ne: false } })),
      SalesInvoice.exists(lineUom),
      SalesReturn.exists(lineUom),
      PurchaseInvoice.exists(lineUom),
      PurchaseReturn.exists(lineUom),
    ]);

  if (inProducts || inSales || inSalesRet || inPurchase || inPurchaseRet) {
    throw new ApiError(
      409,
      "Cannot delete this unit of measure because it is used by products or billing documents."
    );
  }
};

export const assertItemNotInUse = async (companyId, itemId) => {
  const oid = toObjectId(itemId);
  if (!oid) throw new ApiError(400, "Invalid product id");

  const base = confirmedBillingFilter(companyId);
  const lineFilter = { ...base, "items.itemId": oid };

  const [inSales, inSalesRet, inPurchase, inPurchaseRet, inStock, inLedger] =
    await Promise.all([
      SalesInvoice.exists(lineFilter),
      SalesReturn.exists(lineFilter),
      PurchaseInvoice.exists(lineFilter),
      PurchaseReturn.exists(lineFilter),
      Stock.exists(companyFilter(companyId, { itemId: oid })),
      StockLedger.exists(companyFilter(companyId, { itemId: oid })),
    ]);

  if (inSales || inSalesRet || inPurchase || inPurchaseRet || inStock || inLedger) {
    throw new ApiError(
      409,
      "Cannot delete this product because it is used in invoices, returns, or stock."
    );
  }
};

export const assertCustomerNotInUse = async (companyId, customerId) => {
  const oid = toObjectId(customerId);
  if (!oid) throw new ApiError(400, "Invalid customer id");

  const billing = confirmedBillingFilter(companyId);
  const vouchers = activeVoucherFilter(companyId);

  const [
    inSales,
    inSalesRet,
    inPurchase,
    inPurchaseRet,
    inReceipts,
    inJournalCustomer,
    inJournalVendor,
  ] = await Promise.all([
    SalesInvoice.exists({ ...billing, ...refIn("customerId", customerId) }),
    SalesReturn.exists({ ...billing, ...refIn("customerId", customerId) }),
    PurchaseInvoice.exists({ ...billing, ...refIn("vendorId", customerId) }),
    PurchaseReturn.exists({ ...billing, ...refIn("vendorId", customerId) }),
    ReceiptPayment.exists({ ...vouchers, ...refIn("partyId", customerId) }),
    JournalEntry.exists({
      ...companyFilter(companyId),
      status: "posted",
      "lines.customerId": oid,
    }),
    JournalEntry.exists({
      ...companyFilter(companyId),
      status: "posted",
      "lines.vendorId": oid,
    }),
  ]);

  if (
    inSales ||
    inSalesRet ||
    inPurchase ||
    inPurchaseRet ||
    inReceipts ||
    inJournalCustomer ||
    inJournalVendor
  ) {
    throwInUse("customer or vendor");
  }
};

export const assertWarehouseNotInUse = async (companyId, warehouseId) => {
  const oid = toObjectId(warehouseId);
  if (!oid) throw new ApiError(400, "Invalid warehouse id");

  const billing = confirmedBillingFilter(companyId);
  const wh = refIn("warehouseId", warehouseId);

  const [inSales, inSalesRet, inPurchase, inPurchaseRet, inStock, inLedger] =
    await Promise.all([
      SalesInvoice.exists({ ...billing, ...wh }),
      SalesReturn.exists({ ...billing, ...wh }),
      PurchaseInvoice.exists({ ...billing, ...wh }),
      PurchaseReturn.exists({ ...billing, ...wh }),
      Stock.exists({ ...companyFilter(companyId), ...wh }),
      StockLedger.exists({ ...companyFilter(companyId), ...wh }),
    ]);

  if (inSales || inSalesRet || inPurchase || inPurchaseRet || inStock || inLedger) {
    throwInUse("warehouse");
  }
};

export const assertPriceLevelNotInUse = async (companyId, priceLevelId) => {
  const oid = toObjectId(priceLevelId);
  if (!oid) throw new ApiError(400, "Invalid price level id");

  const billing = confirmedBillingFilter(companyId);
  const pl = refIn("priceLevelId", priceLevelId);

  const [inSales, inSalesRet] = await Promise.all([
    SalesInvoice.exists({ ...billing, ...pl }),
    SalesReturn.exists({ ...billing, ...pl }),
  ]);

  if (inSales || inSalesRet) throwInUse("price level");
};

export const assertBankAccountNotInUse = async (companyId, bankAccountId) => {
  const oid = toObjectId(bankAccountId);
  if (!oid) throw new ApiError(400, "Invalid bank account id");

  const [inVouchers, inExpense] = await Promise.all([
    ReceiptPayment.exists({
      ...activeVoucherFilter(companyId),
      ...refIn("bankAccountId", bankAccountId),
    }),
    Expense.exists({
      ...companyFilter(companyId, { status: "completed", isActive: { $ne: false } }),
      ...refIn("bankAccountId", bankAccountId),
    }),
  ]);

  if (inVouchers || inExpense) throwInUse("bank account");
};

export const assertBranchNotInUse = async (companyId, branchId) => {
  const oid = toObjectId(branchId);
  if (!oid) throw new ApiError(400, "Invalid branch id");

  const br = refIn("branchId", branchId);
  const billing = confirmedBillingFilter(companyId);

  const [
    inUsers,
    inWarehouses,
    inSales,
    inSalesRet,
    inPurchase,
    inPurchaseRet,
    inVouchers,
    inExpense,
    inJournal,
    inStock,
    inLedger,
  ] = await Promise.all([
    User.exists({ ...companyFilter(companyId, { isActive: { $ne: false } }), ...br }),
    Warehouse.exists({ ...companyFilter(companyId, { isActive: { $ne: false } }), ...br }),
    SalesInvoice.exists({ ...billing, ...br }),
    SalesReturn.exists({ ...billing, ...br }),
    PurchaseInvoice.exists({ ...billing, ...br }),
    PurchaseReturn.exists({ ...billing, ...br }),
    ReceiptPayment.exists({ ...activeVoucherFilter(companyId), ...br }),
    Expense.exists({
      ...companyFilter(companyId, { status: "completed", isActive: { $ne: false } }),
      ...br,
    }),
    JournalEntry.exists({ ...companyFilter(companyId, { status: "posted" }), ...br }),
    Stock.exists({ ...companyFilter(companyId), ...br }),
    StockLedger.exists({ ...companyFilter(companyId), ...br }),
  ]);

  if (
    inUsers ||
    inWarehouses ||
    inSales ||
    inSalesRet ||
    inPurchase ||
    inPurchaseRet ||
    inVouchers ||
    inExpense ||
    inJournal ||
    inStock ||
    inLedger
  ) {
    throwInUse("branch");
  }
};
