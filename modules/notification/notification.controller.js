import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/ApiResponse.js";
import * as svc from "./notification.service.js";
import { emitNotificationsUpdated } from "../../socket/notificationEmitter.js";

const ctx = (req) => ({
  companyId: req.companyId,
  financialYearId: req.fyId,
  userId: req.user?.id,
});

export const listNotifications = asyncHandler(async (req, res) => {
  const data = await svc.listNotifications(ctx(req));
  res.json(new ApiResponse(200, data));
});

export const setNotificationRead = asyncHandler(async (req, res) => {
  const isRead = req.body?.isRead !== false;
  const requestCtx = ctx(req);
  const data = await svc.setNotificationRead(
    requestCtx,
    req.params.id,
    isRead,
  );
  emitNotificationsUpdated(
    requestCtx.companyId,
    requestCtx.financialYearId,
  );
  res.json(new ApiResponse(200, data, "Notification updated"));
});

export const markAllRead = asyncHandler(async (req, res) => {
  const requestCtx = ctx(req);
  const data = await svc.markAllNotificationsRead(requestCtx);
  emitNotificationsUpdated(
    requestCtx.companyId,
    requestCtx.financialYearId,
  );
  res.json(new ApiResponse(200, data, "All notifications marked as read"));
});
