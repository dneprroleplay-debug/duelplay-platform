# DuelPlay Admin RBAC Foundation

This patch preserves the legacy `User.role` field and existing admin routes, while adding `AdminRoleAssignment` as the source of the new 10-level RBAC plus Founder 999.

## Important
- Do not change CS2 manager, nickname, avatar, GrenadeOnly, or match lifecycle files for this patch.
- Do not deploy the previous `duelplay-admin-rbac-patch.zip`. This package supersedes it.
- Database schema change is additive.
- Existing legacy roles remain compatible.
- New role permissions are enforced server-side in the RBAC layer.

## Roles
LEVEL 1 SUPERADMIN, 2 FINANCIAL ADMIN, 3 ADMIN, 4 MODERATOR, 5 SUPPORT, 6 AUDITOR, 7 TECH ADMIN, 8 CONTENT ADMIN, 9 ANALYST, 10 SECURITY ADMIN, 999 FOUNDER.

## Deployment order
1. Back up the current project/database.
2. Replace the corresponding files from this package.
3. Run `npx prisma validate`.
4. Run `npx prisma generate`.
5. Run `npx prisma db push`.
6. Run the normal production build.
7. Open `/admin/access` and verify the Founder/role catalog.

No existing CS2 or finance runtime code is intentionally rewritten.
