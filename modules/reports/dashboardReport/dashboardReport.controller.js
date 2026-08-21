import asyncHandler from "../../../utils/asyncHandler.js";
import ApiResponse from "../../../utils/ApiResponse.js";
import SalesInvoice from "../../sales/salesInvoice/salesInvoice.model.js";
import PurchaseInvoice from "../../purchase/purchaseInvoice/purchaseInvoice.model.js";
import ReceiptPayment from "../../receipt-payment/receiptPayment.model.js";
import Stock from "../../stock/stock.model.js";
import "../../masters/item/item.model.js";

const LOW_STOCK_THRESHOLD = 10;

const getRangeWindow = (range) => {
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const start = new Date();
  start.setHours(0, 0, 0, 0);

  if (range === "weekly") {
    start.setDate(end.getDate() - 6);
  } else if (range === "monthly") {
    start.setDate(1);
  } else if (range === "yearly") {
    start.setMonth(0, 1);
  }

  const durationMs = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - durationMs);
  prevStart.setHours(0, 0, 0, 0);

  return { start, end, prevStart, prevEnd };
};

const sumInRange = async (Model, dateField, filter, start, end) => {
  const rows = await Model.find({
    ...filter,
    [dateField]: { $gte: start, $lte: end },
  })
    .select("grandTotal")
    .lean();

  return Number(rows.reduce((s, r) => s + (r.grandTotal || 0), 0).toFixed(2));
};

const trendPercent = (current, previous) => {
  if (!previous) return current > 0 ? 100 : 0;
  return Number((((current - previous) / previous) * 100).toFixed(1));
};

const bucketFormat = (range) => {
  if (range === "yearly") return "%Y-%m";
  return "%Y-%m-%d";
};

const formatBucketLabel = (key, range) => {
  if (range === "yearly") {
    const [year, month] = key.split("-");
    return new Date(Number(year), Number(month) - 1, 1).toLocaleString("en-IN", {
      month: "short",
    });
  }
  const date = new Date(key);
  if (range === "weekly") {
    return date.toLocaleString("en-IN", { weekday: "short" });
  }
  if (range === "monthly") {
    return date.toLocaleString("en-IN", { day: "2-digit", month: "short" });
  }
  return date.toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit" });
};

const aggregateTrend = async (Model, dateField, filter, start, end, range) => {
  const format = bucketFormat(range);
  const rows = await Model.aggregate([
    {
      $match: {
        ...filter,
        [dateField]: { $gte: start, $lte: end },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format, date: `$${dateField}` } },
        total: { $sum: "$grandTotal" },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return rows.map((row) => ({
    key: row._id,
    label: formatBucketLabel(row._id, range),
    value: Number((row.total / 1000).toFixed(2)),
  }));
};

const mergeTrend = (salesRows, purchaseRows) => {
  const keys = [...new Set([...salesRows.map((r) => r.key), ...purchaseRows.map((r) => r.key)])].sort();
  const salesMap = Object.fromEntries(salesRows.map((r) => [r.key, r]));
  const purchaseMap = Object.fromEntries(purchaseRows.map((r) => [r.key, r]));

  return keys.map((key) => ({
    month: salesMap[key]?.label || purchaseMap[key]?.label || key,
    sales: salesMap[key]?.value || 0,
    purchase: purchaseMap[key]?.value || 0,
  }));
};

export const dashboardReport = asyncHandler(async (req, res) => {
  const range = req.query.range || "monthly";
  const { start, end, prevStart, prevEnd } = getRangeWindow(range);

  const baseFilter = {
    companyId: req.companyId,
    branchId: req.branchId,
    financialYearId: req.fyId,
    isActive: true,
    status: "confirmed",
  };

  const voucherFilter = {
    companyId: req.companyId,
    branchId: req.branchId,
    financialYearId: req.fyId,
    isActive: true,
    status: "completed",
  };

  const [
    salesTotal,
    purchaseTotal,
    prevSalesTotal,
    prevPurchaseTotal,
    receiptsTotal,
    paymentsTotal,
    salesTrendRows,
    purchaseTrendRows,
    salesTypeRows,
    paymentStatusRows,
    recentSales,
    recentPurchases,
    lowStockRows,
  ] = await Promise.all([
    sumInRange(SalesInvoice, "invoiceDate", baseFilter, start, end),
    sumInRange(PurchaseInvoice, "purchaseDate", baseFilter, start, end),
    sumInRange(SalesInvoice, "invoiceDate", baseFilter, prevStart, prevEnd),
    sumInRange(PurchaseInvoice, "purchaseDate", baseFilter, prevStart, prevEnd),
    sumInRange(ReceiptPayment, "date", { ...voucherFilter, voucherType: "receipt" }, start, end),
    sumInRange(ReceiptPayment, "date", { ...voucherFilter, voucherType: "payment" }, start, end),
    aggregateTrend(SalesInvoice, "invoiceDate", baseFilter, start, end, range),
    aggregateTrend(PurchaseInvoice, "purchaseDate", baseFilter, start, end, range),
    SalesInvoice.aggregate([
      { $match: { ...baseFilter, invoiceDate: { $gte: start, $lte: end } } },
      { $group: { _id: "$salesType", total: { $sum: "$grandTotal" } } },
    ]),
    SalesInvoice.aggregate([
      { $match: { ...baseFilter, invoiceDate: { $gte: start, $lte: end } } },
      { $group: { _id: "$paymentStatus", count: { $sum: 1 } } },
    ]),
    SalesInvoice.find(baseFilter)
      .populate("customerId", "name")
      .select("invoiceNo invoiceDate customerId customerSnapshot grandTotal paymentStatus items")
      .sort({ invoiceDate: -1 })
      .limit(5)
      .lean(),
    PurchaseInvoice.find(baseFilter)
      .populate("vendorId", "name")
      .select("invoiceNo purchaseDate vendorId vendorSnapshot grandTotal paymentStatus items status")
      .sort({ purchaseDate: -1 })
      .limit(5)
      .lean(),
    Stock.find({
      companyId: req.companyId,
      financialYearId: req.fyId,
      qty: { $lte: LOW_STOCK_THRESHOLD },
    })
      .populate("itemId", "name code")
      .sort({ qty: 1 })
      .limit(10)
      .lean(),
  ]);

  const retail = salesTypeRows.find((r) => r._id === "retail")?.total || 0;
  const wholesale = salesTypeRows.find((r) => r._id === "wholesale")?.total || 0;
  const salesTypeTotal = retail + wholesale || 1;

  const paid = paymentStatusRows.find((r) => r._id === "paid")?.count || 0;
  const partial = paymentStatusRows.find((r) => r._id === "partial")?.count || 0;
  const pending =
    (paymentStatusRows.find((r) => r._id === "pending")?.count || 0) +
    (paymentStatusRows.find((r) => r._id === "unpaid")?.count || 0);

  res.json(
    new ApiResponse(200, {
      range,
      stats: {
        salesTotal,
        purchaseTotal,
        receiptsTotal,
        paymentsTotal,
        salesTrend: trendPercent(salesTotal, prevSalesTotal),
        purchaseTrend: trendPercent(purchaseTotal, prevPurchaseTotal),
      },
      revenueTrend: mergeTrend(salesTrendRows, purchaseTrendRows),
      salesByType: {
        retail,
        wholesale,
        retailPercent: Number(((retail / salesTypeTotal) * 100).toFixed(1)),
        wholesalePercent: Number(((wholesale / salesTypeTotal) * 100).toFixed(1)),
        total: Number((retail + wholesale).toFixed(2)),
      },
      paymentStatus: { paid, partial, pending, total: paid + partial + pending },
      recentSales: recentSales.map((row) => ({
        id: row._id,
        invoiceNo: row.invoiceNo,
        customer: row.customerSnapshot?.name || row.customerId?.name || "-",
        date: row.invoiceDate,
        amount: row.grandTotal,
        paymentStatus: row.paymentStatus,
      })),
      recentPurchases: recentPurchases.map((row) => ({
        id: row._id,
        invoiceNo: row.invoiceNo,
        vendor: row.vendorSnapshot?.name || row.vendorId?.name || "-",
        date: row.purchaseDate,
        items: row.items?.length || 0,
        amount: row.grandTotal,
        status: row.status,
      })),
      lowStock: lowStockRows.map((row) => ({
        id: row._id,
        product: row.itemId?.name || "Unknown",
        sku: row.itemId?.code || "-",
        stock: row.qty,
        threshold: LOW_STOCK_THRESHOLD,
      })),
    })
  );
});
