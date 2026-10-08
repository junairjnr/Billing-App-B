import mongoose from "mongoose";
import ApiError from "../../utils/ApiError.js";
import itemModel from "./item/item.model.js";
import SalesInvoice from "../sales/salesInvoice/salesInvoice.model.js";
import SalesReturn from "../sales/salesReturn/salesReturn.model.js";
import PurchaseInvoice from "../purchase/purchaseInvoice/purchaseInvoice.model.js";
import PurchaseReturn from "../purchase/purchaseReturn/purchaseReturn.model.js";
import Stock from "../stock/stock.model.js";
import StockLedger from "../stock/stockLedger.model.js";

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

export const assertCategoryNotInUse = async (companyId, categoryId) => {
  const oid = toObjectId(categoryId);
  if (!oid) throw new ApiError(400, "Invalid category id");

  const inProducts = await itemModel.exists(
    companyFilter(companyId, { categoryId: oid })
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

  const base = companyFilter(companyId);

  const [inProducts, inSales, inSalesRet, inPurchase, inPurchaseRet] =
    await Promise.all([
      itemModel.exists({ ...base, uomId: oid }),
      SalesInvoice.exists({ ...base, "items.uomId": oid }),
      SalesReturn.exists({ ...base, "items.uomId": oid }),
      PurchaseInvoice.exists({ ...base, "items.uomId": oid }),
      PurchaseReturn.exists({ ...base, "items.uomId": oid }),
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

  const base = companyFilter(companyId);
  const lineFilter = { ...base, "items.itemId": oid };

  const [inSales, inSalesRet, inPurchase, inPurchaseRet, inStock, inLedger] =
    await Promise.all([
      SalesInvoice.exists(lineFilter),
      SalesReturn.exists(lineFilter),
      PurchaseInvoice.exists(lineFilter),
      PurchaseReturn.exists(lineFilter),
      Stock.exists({ ...base, itemId: oid }),
      StockLedger.exists({ ...base, itemId: oid }),
    ]);

  if (inSales || inSalesRet || inPurchase || inPurchaseRet || inStock || inLedger) {
    throw new ApiError(
      409,
      "Cannot delete this product because it is used in invoices, returns, or stock."
    );
  }
};
