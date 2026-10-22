"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import MatchHistory from "@/components/Match/MatchHistory";
import { useLanguage } from "@/components/Common/LanguageContext";

const COPY = {
  RU: { back: "← Профиль" },
  UA: { back: "← Профіль" },
  PL: { back: "← Profil" },
  EN: { back: "← Profile" },
} as const;

export default function PublicMatchHistoryPage() {
  const params = useParams<{ nickname: string }>();
  const nickname = decodeURIComponent(String(params?.nickname || ""));
  const { language } = useLanguage();
  const copy = COPY[language as keyof typeof COPY] || COPY.EN;

  return <main className="min-h-screen pb-20 pt-24">
    <div className="mx-auto max-w-7xl px-4 sm:px-6">
      <Link href={`/profile/${encodeURIComponent(nickname)}`} className="inline-flex rounded-xl border border-white/10 px-4 py-2 text-sm font-bold text-zinc-300 transition hover:border-pink-400/40 hover:text-pink-200">{copy.back}</Link>
    </div>
    <MatchHistory variant="full" nickname={nickname}/>
  </main>;
}
