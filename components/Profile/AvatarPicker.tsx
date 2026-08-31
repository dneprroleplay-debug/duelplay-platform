"use client";
import { useRef, useState } from "react";
import { useLanguage } from "@/components/Common/LanguageContext";

const PRESETS = [
  { id: "agent-black", src: "/avatars/cs2-counter.jpg" },
  { id: "agent-gold", src: "/avatars/cs2-gold-agent.jpg" },
  { id: "agent-red", src: "/avatars/cs2-red-agent.jpg" },
  { id: "hood", src: "/avatars/cs2-hood.jpg" },
  { id: "soldier", src: "/avatars/cs2-soldier.jpg" },
  { id: "helmet", src: "/avatars/cs2-helmet.jpg" },
  { id: "gas-mask", src: "/avatars/cs2-gas-mask.jpg" },
  { id: "skull", src: "/avatars/cs2-skull.jpg" },
  { id: "pink-raven", src: "/avatars/pink-raven.svg" },
  { id: "neon", src: "/avatars/neon-cyber.svg" },
  { id: "green-ghost", src: "/avatars/green-ghost.svg" },
  { id: "purple-mask", src: "/avatars/purple-mask.svg" },
];

const FALLBACK = PRESETS[0].src;

export default function AvatarPicker({ value, nickname, onSaved }: { value: string | null; nickname: string; onSaved: (url: string) => void }) {
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function saveAvatar(url: string) {
    setSaving(true); setMessage("");
    try {
      const res = await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ avatarUrl: url }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t.avatarSaveError);
      onSaved(data.user.avatarUrl);
      setOpen(false);
      setMessage(t.avatarSaved);
    } catch (e) { setMessage(e instanceof Error ? e.message : t.avatarSaveError); }
    finally { setSaving(false); }
  }

  async function upload(file: File) {
    if (!file.type.startsWith("image/")) { setMessage(t.avatarImageOnly); return; }
    if (file.size > 5 * 1024 * 1024) { setMessage(t.avatarTooLarge); return; }
    const image = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      image.onload = () => {
        const size = 512;
        const canvas = document.createElement("canvas"); canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext("2d"); if (!ctx) return;
        const scale = Math.max(size / image.width, size / image.height);
        const w = image.width * scale, h = image.height * scale;
        ctx.drawImage(image, (size - w) / 2, (size - h) / 2, w, h);
        saveAvatar(canvas.toDataURL("image/jpeg", 0.9));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  }

  const src = value || FALLBACK;
  return <div className="relative">
    <button type="button" onClick={() => setOpen(v => !v)} className="group relative aspect-square h-24 w-24 overflow-hidden rounded-3xl border border-white/15 bg-black transition hover:border-pink-400/50 hover:shadow-[0_0_28px_rgba(34,211,238,.12)]" aria-label={t.changeAvatar}>
      <img src={src} alt={nickname} className="avatar-square" onError={(e) => { e.currentTarget.src = FALLBACK; }} />
      <span className="absolute inset-x-0 bottom-0 bg-black/75 py-1 text-[10px] font-bold text-white opacity-0 transition group-hover:opacity-100">{t.changeAvatar}</span>
    </button>
    {open && <>
      <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="fixed inset-0 z-20 cursor-default bg-black/20 md:bg-transparent" />
      <div className="absolute left-0 top-28 z-30 w-[330px] rounded-2xl border border-white/10 bg-[#0b0d12] p-4 shadow-2xl">
        <button type="button" aria-label="Close avatar picker" onClick={() => setOpen(false)} className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-lg border border-white/10 text-lg text-zinc-400 transition hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-200">×</button>
        <div className="mb-3 pr-10 text-sm font-bold">{t.chooseAvatar}</div>
        <div className="grid grid-cols-4 gap-2">
          {PRESETS.map(p => <button key={p.id} type="button" disabled={saving} onClick={() => saveAvatar(p.src)} className="avatar-preset aspect-square overflow-hidden rounded-xl border border-white/10 bg-black transition hover:-translate-y-0.5 hover:border-pink-400/60 hover:shadow-[0_8px_24px_rgba(34,211,238,.12)] disabled:opacity-50"><img src={p.src} alt="" className="avatar-square" /></button>)}
        </div>
        <button type="button" disabled={saving} onClick={() => inputRef.current?.click()} className="mt-3 w-full rounded-xl bg-pink-400 px-4 py-3 text-sm font-black text-black transition hover:bg-pink-300 disabled:opacity-50">{saving ? t.saving : t.uploadAvatar}</button>
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.currentTarget.value = ""; }} />
        {message && <p className="mt-2 text-xs text-pink-300">{message}</p>}
        <p className="mt-2 text-[11px] text-zinc-500">{t.avatarHint}</p>
      </div>
    </>}
  </div>;
}
