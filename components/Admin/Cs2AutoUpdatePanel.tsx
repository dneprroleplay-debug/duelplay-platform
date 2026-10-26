"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type ServerState = {
  name: string;
  status: string;
  lastHeartbeat: string | null;
  heartbeatFresh: boolean;
  hasMatch: boolean;
  processId: number | null;
  managerReady: boolean;
  gameProcessReady: boolean;
  gameProcessStatus: string;
  modeControllerVersion: string | null;
  modeControllerCapabilities: string[];
};

type Run = {
  id: string;
  localDate: string;
  scheduledAt: string;
  scheduledLocalTime: string;
  timeZone: string;
  status: string;
  stage: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  publicBuildId: string | null;
  installedBuildIdBefore: string | null;
  installedBuildIdAfter: string | null;
  serverVersionAfter: string | null;
  checkedInstances: Array<Record<string, unknown>> | null;
  diagnostics: Array<Record<string, unknown>> | null;
  errorCode: string | null;
  errorMessage: string | null;
  interventionRequired: boolean;
  maintenanceEnabled: boolean;
  syncMarkerActive: boolean;
};

type Payload = {
  me: { roleCode: string; level: number };
  schedule: {
    enabled: boolean;
    localTime: string;
    timeZone: "Europe/Kyiv";
    revision: number;
    scheduleChangedAt: string | null;
    configured: boolean;
    invalid: boolean;
    nextRunAt: string | null;
    lastCheckedAt: string | null;
    agentStatus: string;
    agentError: string | null;
    agentFresh: boolean;
  };
  maintenance: { enabled: boolean; updatedAt: string | null };
  lastCheckAt: string | null;
  lastActualUpdateAt: string | null;
  servers: ServerState[];
  runs: Run[];
};

const STATUS_LABELS: Record<string, string> = {
  RUNNING: "Выполняется",
  NO_UPDATE: "Обновлений нет",
  UPDATED: "Обновлено",
  UPDATED_WITH_DIAGNOSTICS: "Обновлено с диагностикой",
  INSTANCE_DRIFT: "Расхождение инстансов",
  BLOCKED: "Заблокировано проверками",
  FAILED: "Ошибка",
};

const STATUS_COLORS: Record<string, string> = {
  RUNNING: "border-amber-300/25 bg-amber-300/10 text-amber-100",
  NO_UPDATE: "border-sky-300/25 bg-sky-300/10 text-sky-100",
  UPDATED: "border-emerald-300/25 bg-emerald-300/10 text-emerald-100",
  UPDATED_WITH_DIAGNOSTICS: "border-amber-300/25 bg-amber-300/10 text-amber-100",
  INSTANCE_DRIFT: "border-orange-300/25 bg-orange-300/10 text-orange-100",
  BLOCKED: "border-orange-300/25 bg-orange-300/10 text-orange-100",
  FAILED: "border-red-300/25 bg-red-300/10 text-red-100",
};

function formatDate(value: string | null | undefined, timeZone = "Europe/Kyiv") {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("uk-UA", { dateStyle: "medium", timeStyle: "short", timeZone }).format(date);
}

function formatDuration(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const seconds = Math.max(0, Math.floor(value / 1000));
  return seconds < 60 ? `${seconds} с` : `${Math.floor(seconds / 60)} мин ${seconds % 60} с`;
}

function Badge({ status, children }: { status: string; children: React.ReactNode }) {
  return <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${STATUS_COLORS[status] || "border-white/10 bg-white/[.03] text-zinc-300"}`}>{children}</span>;
}

export default function Cs2AutoUpdatePanel() {
  const router = useRouter();
  const [initialised, setInitialised] = useState(false);
  const dirty = useRef(false);
  const [data, setData] = useState<Payload | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [localTime, setLocalTime] = useState("05:00");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setBusy(true);
    try {
      const response = await fetch("/api/admin/cs2-auto-update", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401 || payload.errorCode === "ADMIN_LOGIN_REQUIRED") {
        router.push("/admin/login");
        return;
      }
      if (!response.ok) throw new Error(payload.error || "Не удалось загрузить состояние автообновления");
      const next = payload as Payload;
      setData(next);
      if (!dirty.current) {
        setEnabled(next.schedule.enabled);
        setLocalTime(next.schedule.localTime);
      }
      setInitialised(true);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ошибка загрузки состояния");
    } finally {
      if (!quiet) setBusy(false);
    }
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    const poll = window.setInterval(() => { void load(true); }, 20_000);
    return () => { window.clearTimeout(timer); window.clearInterval(poll); };
  }, [load]);

  async function save() {
    if (!data || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/cs2-auto-update", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled, localTime, timeZone: "Europe/Kyiv", expectedRevision: data.schedule.revision }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Не удалось сохранить расписание");
      dirty.current = false;
      setNotice("Расписание сохранено. Изменение не запускает обновление немедленно.");
      await load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить расписание");
      await load(true);
    } finally { setSaving(false); }
  }

  function updateEnabled(value: boolean) {
    dirty.current = true;
    setEnabled(value);
  }

  function updateTime(value: string) {
    dirty.current = true;
    setLocalTime(value);
  }

  const latestRun = data?.runs[0] ?? null;

  const currentBuild = latestRun?.installedBuildIdAfter || latestRun?.installedBuildIdBefore || null;

  return <main className="mx-auto min-h-screen max-w-7xl px-4 pb-20 pt-24 text-white sm:px-6">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <a href="/admin/access" className="text-sm text-zinc-500 hover:text-white">← Центр управления</a>
        <div className="mt-4 text-xs font-black uppercase tracking-[.22em] text-[var(--theme-accent)]">СЕРВЕРНАЯ АВТОМАТИЗАЦИЯ</div>
        <h1 className="mt-2 text-3xl font-black sm:text-4xl">Автообновление CS2</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">Расписание задаётся по времени Europe/Kyiv. Сохранение настроек не запускает SteamCMD или игровой процесс.</p>
      </div>
      <button onClick={() => void load()} disabled={busy} className="rounded-xl border border-white/10 px-4 py-2 text-sm font-bold disabled:opacity-50">Обновить состояние</button>
    </div>

    {error && <div role="alert" className="mt-5 rounded-2xl border border-red-400/25 bg-red-400/[.06] p-4 text-sm text-red-200">{error}</div>}
    {notice && <div role="status" className="mt-5 rounded-2xl border border-emerald-400/25 bg-emerald-400/[.06] p-4 text-sm text-emerald-200">{notice}</div>}
    {!data && !error && <div className="mt-6 rounded-3xl border border-white/8 bg-white/[.025] p-8 text-zinc-500">{busy || !initialised ? "Загрузка состояния с VPS…" : "Нет данных."}</div>}

    {data && <>
      <section className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
        <div className="rounded-3xl border border-white/8 bg-black/20 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><div className="text-xs font-black uppercase tracking-[.2em] text-zinc-600">РАСПИСАНИЕ</div><h2 className="mt-2 text-2xl font-black">Ежедневное обслуживание</h2></div>
            <Badge status={data.schedule.enabled ? "UPDATED" : "BLOCKED"}>{data.schedule.enabled ? "Включено" : "Отключено"}</Badge>
          </div>
          {data.schedule.invalid && <p className="mt-4 rounded-xl border border-red-300/20 bg-red-300/[.05] p-3 text-sm text-red-200">Конфигурация расписания некорректна. VPS не запускает обновление по резервному времени.</p>}
          <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_220px]">
            <label className="flex items-center justify-between gap-4 rounded-2xl border border-white/8 bg-white/[.025] p-4">
              <span><b className="block text-sm">Автоматическое обслуживание</b><span className="mt-1 block text-xs text-zinc-500">При отключении poller не запускает updater.</span></span>
              <input type="checkbox" checked={enabled} onChange={event => updateEnabled(event.target.checked)} aria-label="Автоматическое обслуживание CS2" className="h-5 w-5 accent-[var(--theme-accent)]" />
            </label>
            <label className="rounded-2xl border border-white/8 bg-white/[.025] p-4">
              <span className="block text-sm font-bold">Время запуска · 24 часа</span>
              <input type="time" lang="en-GB" step={60} value={localTime} onChange={event => updateTime(event.target.value)} className="input mt-2 w-full" aria-label="Время ежедневного обслуживания" />
              <span className="mt-2 block text-xs text-zinc-500">Часовой пояс зафиксирован: Europe/Kyiv</span>
            </label>
          </div>
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-xl border border-white/6 p-3"><span className="text-xs text-zinc-600">Следующий запуск</span><b className="mt-1 block">{data.schedule.enabled ? formatDate(data.schedule.nextRunAt) : "Нет: расписание отключено"}</b></div>
            <div className="rounded-xl border border-white/6 p-3"><span className="text-xs text-zinc-600">Последняя проверка poller</span><b className="mt-1 block">{formatDate(data.schedule.lastCheckedAt)}</b></div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <span className={`text-xs ${data.schedule.agentFresh ? "text-emerald-200" : "text-amber-200"}`}>{data.schedule.agentFresh ? `VPS scheduler: ${data.schedule.agentStatus}` : "VPS scheduler не сообщал состояние последние 2,5 минуты"}{data.schedule.agentError ? ` · ${data.schedule.agentError}` : ""}</span>
            <button onClick={() => void save()} disabled={saving || !data.schedule.configured && data.schedule.invalid} className="rounded-xl bg-[var(--theme-accent)] px-5 py-2.5 text-sm font-black text-black disabled:opacity-40">{saving ? "Сохранение…" : "Сохранить расписание"}</button>
          </div>
          <p className="mt-3 text-xs leading-5 text-zinc-600">Часы, отсутствующие при весеннем переходе на летнее время, пропускаются до следующей локальной даты. Повторяющаяся осенью локальная минута учитывается не более одного раза за сутки.</p>
        </div>

        <div className="rounded-3xl border border-white/8 bg-black/20 p-5 sm:p-6">
          <div className="text-xs font-black uppercase tracking-[.2em] text-zinc-600">СОСТОЯНИЕ ОБСЛУЖИВАНИЯ</div>
          <h2 className="mt-2 text-2xl font-black">Последний запуск</h2>
          {latestRun ? <>
            <div className="mt-4 flex flex-wrap items-center gap-2"><Badge status={latestRun.status}>{STATUS_LABELS[latestRun.status] || latestRun.status}</Badge>{latestRun.interventionRequired && <span className="rounded-full border border-red-300/20 px-2.5 py-1 text-[10px] font-black text-red-200">Нужно вмешательство</span>}</div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-zinc-600">Начало</dt><dd className="mt-1 font-bold">{formatDate(latestRun.startedAt)}</dd></div>
              <div><dt className="text-xs text-zinc-600">Длительность</dt><dd className="mt-1 font-bold">{formatDuration(latestRun.durationMs)}</dd></div>
              <div><dt className="text-xs text-zinc-600">Публичный Build ID</dt><dd className="mt-1 font-mono">{latestRun.publicBuildId || "—"}</dd></div>
              <div><dt className="text-xs text-zinc-600">Установленный Build ID</dt><dd className="mt-1 font-mono">{currentBuild || "—"}</dd></div>
              <div><dt className="text-xs text-zinc-600">Этап / локальная дата</dt><dd className="mt-1">{latestRun.stage} · {latestRun.localDate}</dd></div>
              <div><dt className="text-xs text-zinc-600">Maintenance / sync marker</dt><dd className="mt-1">{latestRun.maintenanceEnabled ? "maintenance включён" : "maintenance выключен"} · {latestRun.syncMarkerActive ? "marker установлен" : "marker снят"}</dd></div>
            </dl>
            {latestRun.errorMessage && <div className="mt-4 rounded-xl border border-red-300/20 bg-red-300/[.04] p-3 text-sm text-red-100"><b>{latestRun.errorCode || "Ошибка"}</b><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-red-100/75">{latestRun.errorMessage}</p></div>}
          </> : <p className="mt-4 rounded-xl border border-dashed border-white/10 p-6 text-sm text-zinc-500">Запусков пока нет.</p>}
          <div className="mt-4 rounded-xl border border-white/6 p-3 text-sm"><span className="text-xs text-zinc-600">Последнее фактическое обновление</span><b className="mt-1 block">{formatDate(data.lastActualUpdateAt)}</b></div>
          <div className="mt-3 rounded-xl border border-white/6 p-3 text-sm"><span className="text-xs text-zinc-600">Состояние сайта</span><b className="mt-1 block">{data.maintenance.enabled ? "Maintenance включён" : "Рабочий режим"}</b></div>
        </div>
      </section>

      <section className="mt-6 rounded-3xl border border-white/8 bg-black/20 p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><div className="text-xs font-black uppercase tracking-[.2em] text-zinc-600">КЛАСТЕР CS2</div><h2 className="mt-2 text-2xl font-black">Три инстанса</h2></div><span className="text-xs text-zinc-500">Менеджеры и игровые процессы отображаются отдельно</span></div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {data.servers.map(server => <article key={server.name} className="rounded-2xl border border-white/8 bg-white/[.02] p-4">
            <div className="flex items-center justify-between"><b>{server.name}</b><Badge status={server.managerReady && server.heartbeatFresh ? "UPDATED" : "FAILED"}>{server.managerReady && server.heartbeatFresh ? "Manager ready" : "Manager stale"}</Badge></div>
            <div className="mt-3 space-y-1 text-xs text-zinc-500"><p>DB: {server.status} · game process: {server.gameProcessStatus}{server.gameProcessReady ? " (ready)" : ""}</p><p>PID игры: {server.processId ?? "нет"} · match: {server.hasMatch ? "назначен" : "нет"}</p><p>Heartbeat: {formatDate(server.lastHeartbeat)}</p><p>Mode controller: {server.modeControllerVersion || "не подтверждён"}{server.modeControllerCapabilities.length ? ` · ${server.modeControllerCapabilities.join(", ")}` : ""}</p></div>
          </article>)}
          {!data.servers.length && <p className="text-sm text-zinc-500">Нет зарегистрированных серверов.</p>}
        </div>
      </section>

      <section className="mt-6 rounded-3xl border border-white/8 bg-black/20 p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><div className="text-xs font-black uppercase tracking-[.2em] text-zinc-600">ИСТОРИЯ</div><h2 className="mt-2 text-2xl font-black">Последние проверки и обновления</h2></div><span className="text-xs text-zinc-600">Последние {data.runs.length} запусков</span></div>
        <div className="mt-4 space-y-3">
          {data.runs.map(run => <article key={run.id} className="rounded-2xl border border-white/7 bg-white/[.02] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap items-center gap-2"><Badge status={run.status}>{STATUS_LABELS[run.status] || run.status}</Badge><span className="text-xs text-zinc-500">{run.localDate} · {run.scheduledLocalTime} Europe/Kyiv · {run.stage}</span></div><span className="text-xs text-zinc-600">{formatDuration(run.durationMs)} · {formatDate(run.startedAt)}</span></div>
            <div className="mt-2 text-xs text-zinc-500">Public {run.publicBuildId || "—"} → installed {run.installedBuildIdAfter || run.installedBuildIdBefore || "—"}{run.serverVersionAfter ? ` · ServerVersion ${run.serverVersionAfter}` : ""}</div>
            {run.errorMessage && <p className="mt-2 text-xs text-red-200">{run.errorCode}: {run.errorMessage}</p>}
            {Boolean(run.diagnostics?.length || run.checkedInstances?.length) && <details className="mt-3"><summary className="cursor-pointer text-xs text-zinc-500">Диагностика и проверки инстансов</summary><pre className="mt-2 max-h-80 overflow-auto rounded-xl bg-black/40 p-3 text-[11px] leading-5 text-zinc-400">{JSON.stringify({ checkedInstances: run.checkedInstances, diagnostics: run.diagnostics }, null, 2)}</pre></details>}
          </article>)}
          {!data.runs.length && <p className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-zinc-500">История появится после первого планового запуска.</p>}
        </div>
      </section>
    </>}
  </main>;
}
