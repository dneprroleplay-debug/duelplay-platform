"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { siteConfig } from "@/lib/config/site";
import { DiscordIcon, SteamIcon, TelegramIcon } from "../Common/SocialIcons";

type SocialLinks = { discord: string; steamGroup: string; telegram: string; supportUrl: string; supportEmail: string };
const DEFAULT_LINKS: SocialLinks = {
  discord: siteConfig.socialLinks.discord,
  steamGroup: siteConfig.socialLinks.steamGroup,
  telegram: siteConfig.socialLinks.telegram,
  supportUrl: siteConfig.support.ticketUrl,
  supportEmail: siteConfig.socialLinks.supportEmail,
};
const platformLinks = [
  { href: "/matches", label: "Open duels" },
  { href: "/create", label: "Create a duel" },
  { href: "/live", label: "Live matches" },
  { href: "/rating", label: "Rating" },
];
const legalLinks = [
  { href: "/terms", label: "Terms of Service" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/fair-play", label: "Fair Play & Anti-Cheat" },
];
function socialLinkClass() {
  return "group flex min-w-0 items-center gap-3 rounded-xl border border-white/10 bg-white/[.025] px-3 py-2 transition hover:border-[var(--theme-accent)]/40 hover:bg-[var(--theme-accent-bg)] hover:text-[var(--theme-accent)]";
}
function SocialIconFrame({ children }: { children: React.ReactNode }) {
  return <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/5 bg-black/30">{children}</span>;
}

export default function Footer() {
  const [social, setSocial] = useState<SocialLinks>(DEFAULT_LINKS);
  useEffect(() => {
    let active = true;
    const refresh = () => fetch("/api/site-settings", { cache: "no-store" })
      .then(response => response.ok ? response.json() : null)
      .then(data => { if (active && data?.socialLinks) setSocial({ ...DEFAULT_LINKS, ...data.socialLinks }); })
      .catch(() => {});
    void refresh();
    window.addEventListener("duelplay:social-links-updated", refresh);
    return () => { active = false; window.removeEventListener("duelplay:social-links-updated", refresh); };
  }, []);

  return (
    <footer className="relative mt-12 overflow-hidden border-t border-white/10 bg-[#050507]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--theme-accent)]/50 to-transparent" />
      <div className="pointer-events-none absolute -left-24 top-0 h-48 w-48 rounded-full bg-[var(--theme-accent)]/[.04] blur-3xl" />
      <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="grid gap-7 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr] lg:gap-10">
          <div>
            <Link href="/" className="inline-flex items-center gap-2.5 font-black tracking-tight">
              <Image src="/branding/duelplay-logo-transparent.png" alt="DuelPlay" width={32} height={32} className="h-8 w-8 object-contain" />
              <span className="text-lg tracking-[-.03em]">DUEL<span className="text-[var(--theme-accent)]">PLAY</span></span>
            </Link>
            <p className="mt-3 max-w-sm text-sm leading-6 text-zinc-500">Competitive CS2 duels. One opponent, one match, and the entire pot goes to the winner.</p>
            <p className="mt-3 text-[10px] uppercase tracking-[.2em] text-zinc-600">CS2 · 1v1 · Skill first</p>
          </div>

          <div>
            <h2 className="text-[11px] font-black uppercase tracking-[.2em] text-zinc-400">Community &amp; Support</h2>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1">
              <a href={social.discord} target="_blank" rel="noopener noreferrer" className={socialLinkClass()}><SocialIconFrame><DiscordIcon className="h-4 w-4" /></SocialIconFrame><span className="truncate text-sm">Discord</span></a>
              <a href={social.steamGroup} target="_blank" rel="noopener noreferrer" className={socialLinkClass()}><SocialIconFrame><SteamIcon className="h-4 w-4" /></SocialIconFrame><span className="truncate text-sm">Steam Community</span></a>
              <a href={social.telegram} target="_blank" rel="noopener noreferrer" className={socialLinkClass()}><SocialIconFrame><TelegramIcon className="h-4 w-4" /></SocialIconFrame><span className="truncate text-sm">Telegram</span></a>
            </div>
            <a href={`mailto:${social.supportEmail}`} aria-label={`Email support: ${social.supportEmail}`} className="mt-3 inline-flex max-w-full items-center gap-2 rounded-xl border border-[var(--theme-accent)]/30 bg-[var(--theme-accent-bg)] px-3.5 py-2.5 text-sm font-bold text-[var(--theme-accent)] transition hover:border-[var(--theme-accent)]/60 hover:brightness-110"><span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-[var(--theme-accent)]/20 bg-black/20 text-base">✉</span><span className="break-all">{social.supportEmail}</span></a>
          </div>

          <div>
            <h2 className="text-[11px] font-black uppercase tracking-[.2em] text-zinc-400">Platform</h2>
            <nav className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-1" aria-label="Footer">
              {platformLinks.map(link => <Link key={link.href} href={link.href} className="w-fit text-zinc-500 transition hover:text-[var(--theme-accent)]">{link.label}</Link>)}
              <a href={siteConfig.url} target="_blank" rel="noopener noreferrer" className="w-fit text-zinc-500 transition hover:text-[var(--theme-accent)]">duelplaygame.com</a>
            </nav>
            <nav className="mt-5 flex flex-wrap gap-x-4 gap-y-2 border-t border-white/[.06] pt-4 text-xs" aria-label="Legal">
              {legalLinks.map(link => <Link key={link.href} href={link.href} className="text-zinc-500 transition hover:text-[var(--theme-accent)]">{link.label}</Link>)}
            </nav>
          </div>
        </div>
        <div className="mt-7 flex flex-col gap-1.5 border-t border-white/[.06] pt-4 text-[11px] text-zinc-600 sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 DuelPlay. All rights reserved.</span>
          <span>CS2 · 1v1 competitive matchmaking</span>
        </div>
      </div>
    </footer>
  );
}
