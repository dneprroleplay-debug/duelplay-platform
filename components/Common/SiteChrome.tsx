"use client";

import { usePathname } from "next/navigation";
import Header from "@/components/Header/Header";
import Footer from "@/components/Footer/Footer";
import SupportWidget from "@/components/Support/SupportWidget";

const AUTH_PATHS = new Set([
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
]);

export default function SiteChrome() {
  const pathname = usePathname();
  const isAuthPage = AUTH_PATHS.has(pathname);

  if (isAuthPage) return null;
  return <>
    <Header />
    <SupportWidget />
    <Footer />
  </>;
}
