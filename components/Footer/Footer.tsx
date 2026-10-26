import Image from "next/image";
import Link from "next/link";
import { siteConfig } from "@/lib/config/site";
import { DiscordIcon, SteamIcon, TelegramIcon } from "../Common/SocialIcons";

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
  return "group flex items-center gap-3 rounded-xl border border-white/10 bg-white/[.03] px-3 py-2.5 text-sm text-zinc-300 transition hover:border-[var(--theme-accent)]/40 hover:bg-[var(--theme-accent-bg)] hover:text-[var(--theme-accent)]";
}

function SocialIconFrame({ children }: { children: React.ReactNode }) {
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/5 bg-black/30">
      {children}
    </span>
  );
}

export default function Footer() {
  const supportEmail = siteConfig.socialLinks.supportEmail;

  return (
    <footer className="relative mt-auto overflow-hidden border-t border-white/10 bg-[#050507]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--theme-accent)]/50 to-transparent" />
      <div className="pointer-events-none absolute -left-24 top-0 h-64 w-64 rounded-full bg-[var(--theme-accent)]/[.05] blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-64 w-64 rounded-full bg-[var(--theme-accent)]/[.04] blur-3xl" />

      <div className="relative mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-[1.25fr_1fr_1fr]">
          <div>
            <Link href="/" className="inline-flex items-center gap-3 font-black tracking-tight">
              <Image src="/branding/duelplay-logo-transparent.png" alt="DuelPlay" width={40} height={40} className="h-10 w-10 object-contain" />
              <span className="text-xl tracking-[-.03em]">DUEL<span className="text-[var(--theme-accent)]">PLAY</span></span>
            </Link>
            <p className="mt-4 max-w-sm text-sm leading-6 text-zinc-500">
              Competitive CS2 duels. One opponent, one match, and the entire pot goes to the winner.
            </p>
            <p className="mt-5 text-[11px] uppercase tracking-[.22em] text-zinc-600">CS2 · 1v1 · Skill first</p>
          </div>

          <div>
            <h2 className="text-xs font-black uppercase tracking-[.2em] text-zinc-400">Community &amp; Support</h2>
            <div className="mt-4 space-y-2">
              <a href={siteConfig.socialLinks.discord} target="_blank" rel="noopener noreferrer" className={socialLinkClass()}>
                <SocialIconFrame><DiscordIcon className="h-4 w-4" /></SocialIconFrame>
                <span>Discord</span>
              </a>
              <a href={siteConfig.socialLinks.steamGroup} target="_blank" rel="noopener noreferrer" className={socialLinkClass()}>
                <SocialIconFrame><SteamIcon className="h-4 w-4" /></SocialIconFrame>
                <span>Steam Community</span>
              </a>
              {siteConfig.socialLinks.telegram && (
                <a href={siteConfig.socialLinks.telegram} target="_blank" rel="noopener noreferrer" className={socialLinkClass()}>
                  <SocialIconFrame><TelegramIcon className="h-4 w-4" /></SocialIconFrame>
                  <span>Telegram</span>
                </a>
              )}
              <a
                href={siteConfig.support.ticketUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--theme-accent)] px-4 py-3 text-sm font-black text-black shadow-lg shadow-[var(--theme-glow)] transition hover:brightness-110"
              >
                <DiscordIcon className="h-4 w-4" />
                Discord Support
              </a>
              {supportEmail && (
                <a href={`mailto:${supportEmail}`} className="block pt-1 text-center text-xs text-zinc-500 transition hover:text-[var(--theme-accent)]">
                  Email: {supportEmail}
                </a>
              )}
            </div>
          </div>

          <div>
            <h2 className="text-xs font-black uppercase tracking-[.2em] text-zinc-400">Platform</h2>
            <nav className="mt-4 grid gap-2 text-sm" aria-label="Footer">
              {platformLinks.map((link) => (
                <Link key={link.href} href={link.href} className="w-fit text-zinc-500 transition hover:text-[var(--theme-accent)]">
                  {link.label}
                </Link>
              ))}
              <a href={siteConfig.url} target="_blank" rel="noopener noreferrer" className="w-fit text-zinc-500 transition hover:text-[var(--theme-accent)]">
                duelplaygame.com
              </a>
            </nav>
          </div>
        </div>

        <div className="mt-10 border-t border-white/5 pt-6">
          <nav className="flex flex-wrap gap-x-5 gap-y-2 text-xs" aria-label="Legal">
            {legalLinks.map((link) => (
              <Link key={link.href} href={link.href} className="text-zinc-500 transition hover:text-[var(--theme-accent)]">
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="mt-4 flex flex-col gap-2 text-xs text-zinc-600 sm:flex-row sm:items-center sm:justify-between">
            <span>© 2026 DuelPlay. All rights reserved.</span>
            <span>CS2 · 1v1 competitive matchmaking</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
