"use client";
import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "../Common/LanguageContext";

export default function AuthPanel() {
  const { t } = useLanguage();
  const [error, setError] = useState("");
  const [referralCode, setReferralCode] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const steamError = params.get("error");
    if (steamError) {
      setError(
        steamError === "steam_verify" ? t.steamVerifyError :
        steamError === "steam_state" ? t.steamStateError :
        steamError === "account_disabled" ? t.accountDisabled :
        t.steamError
      );
    }
    const ref = params.get("ref");
    if (ref) setReferralCode(ref.toUpperCase());
  }, [t.steamVerifyError, t.steamStateError, t.accountDisabled, t.steamError]);

  const steamHref = useMemo(
    () => referralCode ? `/api/auth/steam?ref=${encodeURIComponent(referralCode)}` : "/api/auth/steam",
    [referralCode]
  );

  return <div className="mx-auto max-w-md pt-10">
    <div className="panel rounded-3xl p-7 sm:p-9">
      <span className="pill">DUELPLAY</span>
      <h1 className="mt-4 text-3xl font-black">{t.authLogin}</h1>
      <p className="mt-3 text-sm leading-6 text-zinc-500">{t.steamOnlyHint}</p>
      {error && <div className="mt-5 rounded-xl border border-red-400/20 bg-red-400/5 p-3 text-sm text-red-300">{error}</div>}
      <a href={steamHref} className="mt-7 flex items-center justify-center gap-3 rounded-2xl border border-white/10 bg-[#171d25] px-5 py-4 font-black text-white transition hover:border-white/25 hover:bg-[#1d2530]">
        <img src="/images/steam.svg" alt="Steam" className="h-7 w-7" />
        {t.loginSteam}
      </a>
      <p className="mt-5 text-center text-xs text-zinc-600">{t.steamAccountRequired}</p>
    </div>
  </div>;
}
