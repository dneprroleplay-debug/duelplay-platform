"use client";

import { useEffect, useState } from "react";

type SocialLinks = { discord: string; steamGroup: string; telegram: string; supportUrl: string; supportEmail: string };
const LABELS: Array<{ key: keyof SocialLinks; label: string; hint: string; type?: string }> = [
  { key: "discord", label: "Discord — сообщество", hint: "Полная HTTPS-ссылка на официальный сервер." },
  { key: "steamGroup", label: "Steam Community", hint: "Ссылка на группу DuelPlay в Steam." },
  { key: "telegram", label: "Telegram", hint: "Ссылка на официальный канал или группу." },
  { key: "supportUrl", label: "Discord Support", hint: "Ссылка на сервер или канал поддержки." },
  { key: "supportEmail", label: "Email поддержки", hint: "Используется для mailto-ссылок.", type: "email" },
];

export default function SocialLinksSettings() {
  const [links, setLinks] = useState<SocialLinks | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/admin/social-links", { cache: "no-store" }).then(async response => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Не удалось загрузить настройки ссылок.");
      return data;
    }).then(data => { if (active) setLinks(data.socialLinks); }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Не удалось загрузить настройки ссылок."); });
    return () => { active = false; };
  }, []);

  async function save() {
    if (!links) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/social-links", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ socialLinks: links }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data.error || "Не удалось сохранить ссылки."); return; }
      setLinks(data.socialLinks);
      setNotice("Ссылки сохранены. Сайт получит обновлённые значения при следующей загрузке настроек.");
      window.dispatchEvent(new Event("duelplay:social-links-updated"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось сохранить ссылки.");
    } finally { setBusy(false); }
  }

  return <section className="panel rounded-3xl p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-xl font-black">Социальные ссылки и поддержка</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">Единые публичные настройки для шапки, нижнего блока, пустого состояния матчей и юридических страниц. Сохранение фиксируется в административном аудите.</p></div>
      <span className="rounded-full border border-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">Settings · MFA</span>
    </div>
    {error && <div role="alert" className="mt-4 rounded-xl border border-red-400/20 bg-red-400/5 p-3 text-sm text-red-300">{error}</div>}
    {notice && <div role="status" className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3 text-sm text-emerald-300">{notice}</div>}
    {!links && !error && <p className="mt-5 text-sm text-zinc-500">Загружаем текущие значения…</p>}
    {links && <>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {LABELS.map(field => <label key={field.key} className="block min-w-0">
          <span className="mb-2 block text-sm font-bold text-zinc-200">{field.label}</span>
          <input type={field.type || "url"} autoComplete="off" spellCheck={false} value={links[field.key]} onChange={event => setLinks(current => current ? { ...current, [field.key]: event.target.value } : current)} className="input w-full" placeholder={field.key === "supportEmail" ? "support@example.com" : "https://…"} />
          <span className="mt-1.5 block text-xs leading-5 text-zinc-600">{field.hint}</span>
        </label>)}
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/[.06] pt-4">
        <p className="max-w-xl text-xs leading-5 text-zinc-600">Разрешены только HTTPS-ссылки без встроенных логина и пароля. Email проверяется отдельно; пустые поля не сохраняются.</p>
        <button type="button" disabled={busy} onClick={() => void save()} className="rounded-xl bg-[var(--theme-accent)] px-5 py-3 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-50">{busy ? "Сохраняем…" : "Сохранить ссылки"}</button>
      </div>
    </>}
  </section>;
}
