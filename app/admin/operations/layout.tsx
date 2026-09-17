import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/current-user";

export default async function SuperadminOperationsLayout({ children }: { children: ReactNode }) {
  const me = await getCurrentUser();
  if (!me || me.role !== "SUPERADMIN") redirect("/admin");
  return children;
}
