export function canManageCs2AutoUpdates(access) {
  return access?.roleCode === 'SUPERADMIN' || access?.level === 999;
}
