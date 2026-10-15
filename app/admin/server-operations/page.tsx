import { redirect } from "next/navigation";
import { hasPermission, requireAnyPermission } from "@/lib/admin-rbac";
import ServerTechnicalConsole from "@/components/Admin/ServerTechnicalConsole";

export default async function ServerOperationsPage() {
  let access;
  try {
    access = await requireAnyPermission(["system.logs.view", "system.incidents.view", "system.incidents.manage"]);
  } catch {
    redirect("/admin/access");
  }
  return <ServerTechnicalConsole canLogs={hasPermission(access.permissions, "system.logs.view")} canIncidents={hasPermission(access.permissions, "system.incidents.view") || hasPermission(access.permissions, "system.incidents.manage")} canManageIncidents={hasPermission(access.permissions, "system.incidents.manage")} />;
}
