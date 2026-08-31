import type { Metadata } from "next";
import "./globals.css";
import { LanguageProvider } from "../components/Common/LanguageContext";
import ScrollToTop from "../components/Common/ScrollToTop";
import { ThemeProvider } from "../components/Common/ThemeProvider";
export const metadata: Metadata = { title: "DuelPlay — Competitive Gaming", description: "CS2 competitive matchmaking platform" };
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ru"><body><LanguageProvider><ThemeProvider>{children}<ScrollToTop/></ThemeProvider></LanguageProvider></body></html>}
