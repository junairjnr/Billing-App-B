import mongoose from "mongoose";
import Notification from "./notification.model.js";
import Stock from "../stock/stock.model.js";
import { LOW_STOCK_THRESHOLD } from "./notification.constants.js";
import ApiError from "../../utils/ApiError.js";

const toObjectId = (id) => new mongoose.Types.ObjectId(String(id));

const mapNotification = (doc, userId) => {
  const readEntry = (doc.readBy || []).find(
    (r) => String(r.userId) === String(userId),
  );
  return {
    id: doc._id.toString(),
    type: doc.type,
    title: doc.title,
    message: doc.message,
    meta: doc.meta,
    isRead: Boolean(readEntry),
    readAt: readEntry?.readAt ?? null,
    createdAt: doc.createdAt,
  };
};

export async function syncLowStockNotifications(ctx) {
  const { companyId, financialYearId } = ctx;

  const lowStockRows = await Stock.find({
    companyId,
    financialYearId,
    qty: { $lte: LOW_STOCK_THRESHOLD },
  })
    .populate("itemId", "name code")
    .sort({ qty: 1 })
    .limit(100)
    .lean();

  const activeKeys = new Set();

  for (const row of lowStockRows) {
    const stockId = row._id.toString();
    const referenceKey = `low_stock:${stockId}`;
    activeKeys.add(referenceKey);

    const itemName = row.itemId?.name || "Unknown item";
    const itemCode = row.itemId?.code || "-";
    const qty = Number(row.qty ?? 0);

    await Notification.findOneAndUpdate(
      { companyId, financialYearId, referenceKey },
      {
        $set: {
          type: "low_stock",
          title: "Low stock alert",
          message: `${itemName} (${itemCode}) is at ${qty} units (threshold ${LOW_STOCK_THRESHOLD}).`,
          meta: {
            stockId: row._id,
            itemId: row.itemId?._id,
            itemName,
            itemCode,
            qty,
            threshold: LOW_STOCK_THRESHOLD,
          },
        },
        $setOnInsert: {
          companyId,
          financialYearId,
          referenceKey,
          readBy: [],
        },
      },
      { upsert: true, new: true },
    );
  }

  const stale = await Notification.find({
    companyId,
    financialYearId,
    type: "low_stock",
    referenceKey: { $nin: [...activeKeys] },
  }).select("_id");

  if (stale.length) {
    await Notification.deleteMany({
      _id: { $in: stale.map((d) => d._id) },
    });
  }
}

export async function listNotifications(ctx) {
  await syncLowStockNotifications(ctx);

  const docs = await Notification.find({
    companyId: ctx.companyId,
    financialYearId: ctx.financialYearId,
  })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  const items = docs.map((doc) => mapNotification(doc, ctx.userId));
  const unreadCount = items.filter((n) => !n.isRead).length;

  return { items, unreadCount };
}

export async function setNotificationRead(ctx, notificationId, isRead) {
  const notification = await Notification.findOne({
    _id: notificationId,
    companyId: ctx.companyId,
    financialYearId: ctx.financialYearId,
  });

  if (!notification) {
    throw new ApiError(404, "Notification not found");
  }

  const userId = toObjectId(ctx.userId);

  if (isRead) {
    const already = (notification.readBy || []).some(
      (r) => String(r.userId) === String(userId),
    );
    if (!already) {
      notification.readBy.push({ userId, readAt: new Date() });
    }
  } else {
    notification.readBy = (notification.readBy || []).filter(
      (r) => String(r.userId) !== String(userId),
    );
  }

  await notification.save();
  return mapNotification(notification.toObject(), ctx.userId);
}

export async function markAllNotificationsRead(ctx) {
  await syncLowStockNotifications(ctx);

  const userId = toObjectId(ctx.userId);
  const docs = await Notification.find({
    companyId: ctx.companyId,
    financialYearId: ctx.financialYearId,
  });

  for (const doc of docs) {
    const already = (doc.readBy || []).some(
      (r) => String(r.userId) === String(userId),
    );
    if (!already) {
      doc.readBy.push({ userId, readAt: new Date() });
      await doc.save();
    }
  }

  return listNotifications(ctx);
}
