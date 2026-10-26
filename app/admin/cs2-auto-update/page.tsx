import { redirect } from "next/navigation";
import { requireCs2AutoUpdateAdmin } from "@/lib/admin-rbac";
import Cs2AutoUpdatePanel from "@/components/Admin/Cs2AutoUpdatePanel";

export default async function Cs2AutoUpdatePage() {
  try {
    await requireCs2AutoUpdateAdmin();
  } catch (error) {
    if (error instanceof Error && error.message === "ADMIN_LOGIN_REQUIRED") redirect("/admin/login");
    redirect("/admin/access");
  }
  return <Cs2AutoUpdatePanel />;
}
