import { getIo } from "./socketServer.js";
import { notificationRoom } from "./notificationRooms.js";

export function emitNotificationsUpdated(companyId, financialYearId) {
  const io = getIo();
  if (!io || !companyId || !financialYearId) return;

  io.to(notificationRoom(companyId, financialYearId)).emit(
    "notifications:updated",
    {
      at: new Date().toISOString(),
    },
  );
}
