import type { Metadata } from "next";
import "./globals.css";
import { LanguageProvider } from "../components/Common/LanguageContext";
import { AuthProvider } from "../components/Common/AuthContext";
import Header from "../components/Header/Header";
import ScrollToTop from "../components/Common/ScrollToTop";
import { ThemeProvider } from "../components/Common/ThemeProvider";
import SiteAtmosphere from "../components/Common/SiteAtmosphere";
import SupportWidget from "../components/Support/SupportWidget";
export const metadata: Metadata = { title: "DuelPlay — Competitive Gaming", description: "CS2 competitive matchmaking platform", icons: { icon: "/branding/duelplay-logo-transparent.png" } };
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ru"><body><LanguageProvider><AuthProvider><ThemeProvider><SiteAtmosphere/><Header/><SupportWidget/>{children}<ScrollToTop/></ThemeProvider></AuthProvider></LanguageProvider></body></html>}
