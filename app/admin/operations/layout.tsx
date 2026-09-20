import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/admin";

export default async function SuperadminOperationsLayout({ children }: { children: ReactNode }) {
  try {
    await requireAdmin(5);
    return children;
  } catch (error) {
    if (error instanceof Error && error.message === "FORBIDDEN") redirect("/admin");
    redirect("/admin");
  }
}
