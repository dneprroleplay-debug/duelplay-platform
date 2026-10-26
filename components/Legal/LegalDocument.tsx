import Link from "next/link";
import type { ReactNode } from "react";
import { siteConfig } from "@/lib/config/site";

const legalLinks = [
  { href: "/terms", label: "Terms of Service" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/fair-play", label: "Fair Play & Anti-Cheat" },
];

export function LegalDocument({
  title,
  summary,
  updated,
  children,
}: {
  title: string;
  summary: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 pb-20 pt-28 sm:px-6">
      <article className="panel overflow-hidden rounded-3xl p-6 sm:p-10">
        <span className="pill">LEGAL</span>
        <h1 className="mt-4 text-4xl font-black sm:text-5xl">{title}</h1>
        <p className="mt-3 max-w-2xl text-zinc-500">{summary}</p>
        <p className="mt-3 text-xs uppercase tracking-[.2em] text-zinc-600">Last updated: {updated}</p>

        <div className="mt-10 space-y-9">{children}</div>

        <section className="mt-12 rounded-2xl border border-white/5 bg-white/[.02] p-5">
          <h2 className="text-lg font-black text-white sm:text-xl">Questions and support</h2>
          <p className="mt-3 text-sm leading-7 text-zinc-400">
            Contact us at{" "}
            <a href={`mailto:${siteConfig.socialLinks.supportEmail}`} className="text-[var(--theme-accent)] hover:underline">
              {siteConfig.socialLinks.supportEmail}
            </a>
            , through the in-app Support widget, or in the{" "}
            <a href={siteConfig.support.ticketUrl} target="_blank" rel="noopener noreferrer" className="text-[var(--theme-accent)] hover:underline">
              DuelPlay Discord community
            </a>
            .
          </p>
          <nav className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs" aria-label="Legal documents">
            {legalLinks.map((link) => (
              <Link key={link.href} href={link.href} className="text-zinc-500 transition hover:text-[var(--theme-accent)]">
                {link.label}
              </Link>
            ))}
          </nav>
        </section>
      </article>
    </main>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-black text-white sm:text-xl">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-7 text-zinc-400">{children}</div>
    </section>
  );
}

export function LegalList({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-2 pl-5 marker:text-[var(--theme-accent)]">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
