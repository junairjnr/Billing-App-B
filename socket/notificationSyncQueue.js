import { syncLowStockNotifications } from "../modules/notification/notification.service.js";
import { emitNotificationsUpdated } from "./notificationEmitter.js";

const timers = new Map();
const DEBOUNCE_MS = 500;

export function queueNotificationSync(companyId, financialYearId) {
  if (!companyId || !financialYearId) return;

  const key = `${String(companyId)}:${String(financialYearId)}`;
  const existing = timers.get(key);
  if (existing) clearTimeout(existing);

  const handle = setTimeout(async () => {
    timers.delete(key);
    try {
      await syncLowStockNotifications({
        companyId,
        financialYearId,
      });
      emitNotificationsUpdated(companyId, financialYearId);
    } catch (err) {
      console.error("[notifications] sync/emit failed:", err?.message || err);
    }
  }, DEBOUNCE_MS);

  timers.set(key, handle);
}
