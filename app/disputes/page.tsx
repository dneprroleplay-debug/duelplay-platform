"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/components/Common/LanguageContext";
import { deferEffectTask } from "@/lib/effect-defer";

type Evidence = { id: string; type?: string | null; fileUrl?: string | null; createdAt?: string };
type DisputeRow = {
  id: string;
  matchId: string;
  status: string;
  reason: string;
  createdAt: string;
  adminDecision?: string | null;
  adminNotes?: string | null;
  evidences?: Evidence[];
  match?: { id?: string; mapName?: string | null; status?: string } | null;
};

const COPY = {
  RU: {
    title: "Споры по матчу",
    matchId: "ID матча",
    reason: "Опишите проблему",
    create: "Создать спор",
    creating: "Создаём…",
    created: "Спор создан и передан на рассмотрение.",
    attach: "Прикрепить материал",
    attaching: "Загружаем…",
    attached: "Материал прикреплён.",
    attachFailed: "Не удалось прикрепить материал.",
    tooBig: "Файл слишком большой (максимум 4 МБ).",
    badType: "Поддерживаются изображения, видео, логи и zip-архивы.",
    empty: "Споров пока нет.",
    status: "Статус",
    decision: "Решение",
    evidence: "Материалы",
    open: "Открыть матч",
    needMatch: "Укажите ID матча.",
    needReason: "Опишите проблему (минимум 10 символов).",
  },
  UA: {
    title: "Спори щодо матчу",
    matchId: "ID матчу",
    reason: "Опишіть проблему",
    create: "Створити спір",
    creating: "Створюємо…",
    created: "Спір створено та передано на розгляд.",
    attach: "Прикріпити матеріал",
    attaching: "Завантажуємо…",
    attached: "Матеріал прикріплено.",
    attachFailed: "Не вдалося прикріпити матеріал.",
    tooBig: "Файл завеликий (максимум 4 МБ).",
    badType: "Підтримуються зображення, відео, логи та zip-архіви.",
    empty: "Спорів поки немає.",
    status: "Статус",
    decision: "Рішення",
    evidence: "Матеріали",
    open: "Відкрити матч",
    needMatch: "Вкажіть ID матчу.",
    needReason: "Опишіть проблему (мінімум 10 символів).",
  },
  EN: {
    title: "Match disputes",
    matchId: "Match ID",
    reason: "Describe the problem",
    create: "Create dispute",
    creating: "Creating…",
    created: "The dispute was created and sent for review.",
    attach: "Attach material",
    attaching: "Uploading…",
    attached: "Material attached.",
    attachFailed: "Could not attach the material.",
    tooBig: "The file is too large (4 MB maximum).",
    badType: "Images, videos, logs and zip archives are supported.",
    empty: "There are no disputes yet.",
    status: "Status",
    decision: "Decision",
    evidence: "Materials",
    open: "Open match",
    needMatch: "Enter the match ID.",
    needReason: "Describe the problem (at least 10 characters).",
  },
  PL: {
    title: "Spory dotyczące meczu",
    matchId: "ID meczu",
    reason: "Opisz problem",
    create: "Utwórz spór",
    creating: "Tworzymy…",
    created: "Spór został utworzony i przekazany do weryfikacji.",
    attach: "Dołącz materiał",
    attaching: "Przesyłamy…",
    attached: "Materiał dołączony.",
    attachFailed: "Nie udało się dołączyć materiału.",
    tooBig: "Plik jest za duży (maksymalnie 4 MB).",
    badType: "Obsługiwane są obrazy, wideo, logi i archiwa zip.",
    empty: "Brak sporów.",
    status: "Status",
    decision: "Decyzja",
    evidence: "Materiały",
    open: "Otwórz mecz",
    needMatch: "Podaj ID meczu.",
    needReason: "Opisz problem (minimum 10 znaków).",
  },
} as const;

const MAX_BYTES = 4 * 1024 * 1024;

function evidenceType(file: File): "IMAGE" | "VIDEO" | "LOG_FILE" | "DEMO_REPLAY" {
  if (file.type.startsWith("image/")) return "IMAGE";
  if (file.type.startsWith("video/")) return "VIDEO";
  if (file.type === "text/plain" || file.type === "application/json") return "LOG_FILE";
  return "DEMO_REPLAY";
}

export default function DisputesPage() {
  const { language } = useLanguage();
  const copy = COPY[language as keyof typeof COPY] || COPY.EN;
  const [rows, setRows] = useState<DisputeRow[]>([]);
  const [matchId, setMatchId] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  async function load() {
    const response = await fetch("/api/disputes", { cache: "no-store" });
    const data = await response.json().catch(() => []);
    setRows(Array.isArray(data) ? (data as DisputeRow[]) : []);
  }

  useEffect(() => {
    deferEffectTask(() => { void load(); });
  }, []);

  async function attach(disputeId: string, file: File) {
    if (file.size > MAX_BYTES) { setMsg(copy.tooBig); return; }
    setUploadingId(disputeId);
    setMsg("");
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("READ_FAILED"));
        reader.readAsDataURL(file);
      });
      const response = await fetch("/api/disputes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "evidence", id: disputeId, type: evidenceType(file), fileUrl: dataUrl }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setMsg(data.error || copy.attachFailed); return; }
      setMsg(copy.attached);
      await load();
    } catch {
      setMsg(copy.attachFailed);
    } finally {
      setUploadingId(null);
    }
  }

  async function create() {
    if (!matchId.trim()) { setMsg(copy.needMatch); return; }
    if (reason.trim().length < 10) { setMsg(copy.needReason); return; }
    setBusy(true);
    setMsg("");
    try {
      const response = await fetch("/api/disputes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId: matchId.trim(), reason: reason.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setMsg(data.error || copy.attachFailed); return; }
      setMatchId("");
      setReason("");
      setMsg(copy.created);
      await load();
    } catch {
      setMsg(copy.attachFailed);
    } finally {
      setBusy(false);
    }
  }

  return <main className="mx-auto min-h-screen max-w-5xl px-4 pb-20 pt-28"><section className="panel rounded-3xl p-7 sm:p-10"><span className="pill">DISPUTES</span><h1 className="mt-4 text-4xl font-black">{copy.title}</h1>
    <div className="mt-6 grid gap-3">
      <input className="input" value={matchId} onChange={(event) => setMatchId(event.target.value)} placeholder={copy.matchId}/>
      <textarea className="input min-h-28" value={reason} onChange={(event) => setReason(event.target.value)} placeholder={copy.reason}/>
      <button onClick={() => void create()} disabled={busy} className="rounded-xl bg-pink-400 px-5 py-3 font-black text-black disabled:opacity-50">{busy ? copy.creating : copy.create}</button>
      {msg && <p className="text-sm text-pink-300">{msg}</p>}
    </div>
    <div className="mt-8 space-y-3">{rows.length ? rows.map((row) => <article key={row.id} className="rounded-2xl border border-white/5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><b className="truncate">{row.match?.id || row.matchId}</b><span className="text-xs text-zinc-500">{copy.status}: {row.status}</span></div>
      <p className="mt-2 text-sm text-zinc-400">{row.reason}</p>
      {row.adminDecision && <p className="mt-2 text-xs text-zinc-500">{copy.decision}: {row.adminDecision}</p>}
      {Array.isArray(row.evidences) && row.evidences.length > 0 && <div className="mt-3 space-y-2"><div className="text-[10px] font-black uppercase tracking-wider text-zinc-600">{copy.evidence}</div>{row.evidences.map((evidence) => <div key={evidence.id} className="flex items-center gap-2 text-xs text-zinc-400">{evidence.fileUrl && evidence.type === "IMAGE" ? <img src={evidence.fileUrl} alt="" className="h-12 w-20 rounded-lg object-cover"/> : evidence.fileUrl ? <a href={evidence.fileUrl} target="_blank" rel="noreferrer" className="underline decoration-pink-400/40">{evidence.type || "FILE"}</a> : <span>{evidence.type || "FILE"}</span>}</div>)}</div>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="cursor-pointer rounded-xl border border-white/10 px-4 py-2 text-xs font-bold text-zinc-300 hover:border-pink-400/40">{uploadingId === row.id ? copy.attaching : copy.attach}<input type="file" className="hidden" disabled={uploadingId === row.id} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void attach(row.id, file); }}/></label>
        <a href={`/matches/${row.matchId}`} className="text-xs text-pink-400">{copy.open} →</a>
      </div>
    </article>) : <p className="text-sm text-zinc-500">{copy.empty}</p>}</div>
  </section></main>;
}
