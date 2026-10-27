"use client";

import { usePathname } from "next/navigation";
import Footer from "@/components/Footer/Footer";

const AUTH_PATHS = new Set(["/login", "/register", "/forgot-password", "/reset-password", "/verify-email"]);

export default function SiteFooter() {
  const pathname = usePathname();
  if (AUTH_PATHS.has(pathname)) return null;
  return <Footer />;
}
