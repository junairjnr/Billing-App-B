export function notificationRoom(companyId, financialYearId) {
  return `notifications:${String(companyId)}:${String(financialYearId)}`;
}
