import Link from "next/link";
import type { ReactNode } from "react";

export default function AuthFrame({
  eyebrow = "PLAYER ACCESS",
  title,
  description,
  children,
  footer,
  wide = false,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <main className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-[#07070b] px-4 py-8 text-white sm:px-6 sm:py-10">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-40 top-16 h-96 w-96 rounded-full bg-pink-500/[.12] blur-[120px]" />
        <div className="absolute -right-32 bottom-0 h-96 w-96 rounded-full bg-emerald-400/[.06] blur-[120px]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,.018)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.018)_1px,transparent_1px)] bg-[size:42px_42px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" />
      </div>
      <div className={`w-full ${wide ? "max-w-2xl" : "max-w-md"}`}>
        <section className="relative overflow-hidden rounded-[24px] border border-white/[.09] bg-[#0d0d13]/95 p-5 shadow-[0_28px_100px_rgba(0,0,0,.55)] backdrop-blur-xl sm:p-7">
          <div aria-hidden className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-pink-400/80 to-transparent" />
          <div className="mb-5 flex items-center justify-start">
            <Link href="/" aria-label="DuelPlay — главная" className="inline-flex items-center gap-2 rounded-xl px-1 py-1 transition hover:opacity-80">
              <img src="/branding/duelplay-logo-transparent.png" alt="DuelPlay" className="h-7 w-7 object-contain" />
              <span className="text-sm font-black tracking-[-.03em]">DUEL<span className="text-pink-400">PLAY</span></span>
            </Link>
          </div>
          <div className="mb-5 text-center">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-pink-400/20 bg-pink-400/[.07] px-3 py-1.5 text-[10px] font-black uppercase tracking-[.22em] text-pink-300">
              <span className="h-1.5 w-1.5 rounded-full bg-pink-400 shadow-[0_0_12px_rgba(255,47,145,.8)]" />{eyebrow}
            </div>
            <h1 className="text-3xl font-black tracking-tight sm:text-[34px]">{title}</h1>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-zinc-400">{description}</p>
          </div>
          {children}
        </section>
        {footer && <div className="mt-5 text-center text-sm text-zinc-500">{footer}</div>}
      </div>
    </main>
  );
}

export function AuthField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="block"><span className="mb-2 flex items-center justify-between gap-3 text-xs font-bold text-zinc-300">{label}{hint && <span className="font-normal text-zinc-600">{hint}</span>}</span>{children}</label>;
}

export const authInputClass = "h-12 w-full rounded-xl border border-white/[.09] bg-black/35 px-4 text-sm text-white outline-none transition placeholder:text-zinc-600 hover:border-white/15 focus:border-pink-400/60 focus:ring-4 focus:ring-pink-400/[.08]";
export const authPrimaryClass = "flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-pink-400 px-4 py-3 text-sm font-black text-[#160711] shadow-[0_8px_28px_rgba(255,47,145,.14)] transition hover:bg-pink-300 hover:shadow-[0_10px_32px_rgba(255,47,145,.22)] disabled:cursor-not-allowed disabled:opacity-50";
export const authSecondaryClass = "flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-white/[.1] bg-white/[.035] px-4 py-3 text-sm font-bold text-zinc-100 transition hover:border-white/20 hover:bg-white/[.06] disabled:opacity-50";
