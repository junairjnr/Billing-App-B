import asyncHandler from "../../../utils/asyncHandler.js";
import ApiResponse from "../../../utils/ApiResponse.js";
import Stock from "../../stock/stock.model.js";
// Ensure refs are registered before populate
import "../../masters/item/item.model.js";
import "../../masters/itemCategory/itemCategory.model.js";
import "../../masters/uom/uom.model.js";
import "../../warehouse/warehouse.model.js";

const parseIncludeZero = (value) => value === true || value === "true";
const DEFAULT_GST_PERCENT = 18;

// ── 1. STOCK REPORT ───────────────────────────────────────────
// Current stock snapshot per item per warehouse
export const stockReport = asyncHandler(async (req, res) => {
  const { warehouseId, categoryId, itemId, includeZero = "false" } = req.query;
  const showZeroStock = parseIncludeZero(includeZero);

  const filter = {
    companyId: req.companyId,
    financialYearId: req.fyId,
  };

  if (warehouseId) filter.warehouseId = warehouseId;
  if (itemId) filter.itemId = itemId;

  // If not including zero stock
  if (!showZeroStock) filter.qty = { $gt: 0 };

  let data = await Stock.find(filter)
    .populate({
      path: "itemId",
      select: "name code hsnCode categoryId uomId taxPercent",
      populate: [
        { path: "categoryId", select: "name" },
        { path: "uomId", select: "name shortCode" },
      ],
    })
    .populate("warehouseId", "name code")
    .lean();

  // Expose uom, rate, and tax breakdown on each row
  data = data.map((row) => {
    const rate = row.avgCost ?? 0;
    const stockValue = Number((row.qty * rate).toFixed(2));
    const taxPercent = Number(row.itemId?.taxPercent) || DEFAULT_GST_PERCENT;
    const sgst = Number(((stockValue * taxPercent) / 200).toFixed(2));
    const cgst = Number(((stockValue * taxPercent) / 200).toFixed(2));

    return {
      ...row,
      uomId: row.itemId?.uomId ?? null,
      rate,
      stockValue,
      sgst,
      cgst,
    };
  });

  data.sort((a, b) =>
    (a.itemId?.name ?? "").localeCompare(b.itemId?.name ?? ""),
  );

  // Filter by category if provided (done after populate)
  if (categoryId) {
    data = data.filter((s) => {
      const item = s?.itemId;
      return item?.categoryId?._id?.toString() === categoryId;
    });
  }

  // Calculate summary
  const totalItems = data.length;
  const totalStockValue = data.reduce((s, r) => s + r.stockValue, 0);

  res.json(
    new ApiResponse(200, {
      data,
      summary: {
        totalItems,
        totalStockValue: Number(totalStockValue.toFixed(2)),
      },
    }),
  );
});
