import type { Metadata } from "next";
import "./globals.css";
import { LanguageProvider } from "../components/Common/LanguageContext";
import { AuthProvider } from "../components/Common/AuthContext";
import ScrollToTop from "../components/Common/ScrollToTop";
import { ThemeProvider } from "../components/Common/ThemeProvider";
import SiteAtmosphere from "../components/Common/SiteAtmosphere";
import MaintenanceGate from "../components/Common/MaintenanceGate";
import LivePlatformSync from "@/components/Common/LivePlatformSync";
import GlobalUiI18n from "../components/Common/GlobalUiI18n";
import { DuelDialogProvider } from "../components/Common/DuelDialogProvider";
import SiteChrome from "@/components/Common/SiteChrome";
import SiteFooter from "@/components/Common/SiteFooter";
export const metadata: Metadata = { title: "DuelPlay — Competitive Gaming", description: "CS2 competitive matchmaking platform", icons: { icon: "/branding/duelplay-logo-transparent.png" } };
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body><LanguageProvider><DuelDialogProvider><GlobalUiI18n/><AuthProvider><ThemeProvider><LivePlatformSync/><SiteAtmosphere/><SiteChrome/><MaintenanceGate>{children}</MaintenanceGate><SiteFooter/><ScrollToTop/></ThemeProvider></AuthProvider></DuelDialogProvider></LanguageProvider></body></html>}
