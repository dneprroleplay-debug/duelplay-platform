"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLanguage } from "@/components/Common/LanguageContext";
import type { GameModeConfig, GameModeId } from "@/lib/game-mode-config.mjs";
import { deferEffectTask } from "@/lib/effect-defer";

type MapRow = { id: string; displayName: string; serverMapName: string };
type AckRow = { serverName: string; status: string; checksum: string; error?: string | null; appliedAt?: string | null };
type RevisionRow = { version: number; status: string; checksum: string; createdAt: string; publishedAt?: string | null; rollbackOfVersion?: number | null };
type Bundle = {
  me: { roleCode: string; level: number };
  state: { publishedVersion: number | null; pendingVersion: number | null; draftVersion: number | null };
  published: RevisionRow & { config: GameModeConfig } | null;
  pending: RevisionRow & { config: GameModeConfig } | null;
  draft: RevisionRow & { config: GameModeConfig } | null;
  acknowledgements: AckRow[];
  requiredServers: string[];
  servers: Array<{ name: string; status: string; lastHeartbeat: string | null; metadata: unknown }>;
  mapCatalog: MapRow[];
  mapSafetyProfiles: Array<{ mapId: string; verified: boolean; minimumSafeGravityPercent?: number }>;
  weaponCatalog: Array<{ weapon: string; slot: string; category: string }>;
  grenadeCatalog: Array<{ id: string }>;
  history: RevisionRow[];
};

const COPY = {
  RU: { title: "Игровые режимы", subtitle: "Черновики не меняют активные матчи. Публикация станет активной только после checksum-подтверждения cs2-1, cs2-2 и cs2-3.", loading: "Загрузка конфигураций…", enabled: "Режим включён", allMaps: "Все совместимые карты", maps: "Карты", settings: "Параметры", save: "Сохранить черновик", validate: "Проверить", publish: "Опубликовать", rollback: "Откатить на эту версию", history: "История версий", published: "Активная версия", pending: "Синхронизация ожидает подтверждений", draft: "Черновик", synced: "Подтверждено всеми тремя серверами", notSynced: "Нет подтверждения всех трёх серверов", safetyMissing: "Профиль безопасности карты ещё не проверен; Low Gravity нельзя опубликовать для этой карты.", cooldown: "Cooldown восстановления (сек.)", types: "Типы гранат", count: "Доступное количество", typeCooldown: "Cooldown типа (пусто = общий)", weaponPool: "Пул оружия", selectionScope: "Выбор оружия", roundScope: "Каждый раунд", matchScope: "Один раз на матч", gravity: "Гравитация (% от обычной)", speed: "Скорость (% от обычной)", targetKills: "Цель по убийствам", roundTime: "Время раунда (сек.)", maxRounds: "Лимит раундов", health: "Здоровье", armor: "Броня", startMoney: "Стартовые деньги", maxMoney: "Лимит денег", afterRoundMoney: "Деньги после раунда", ammo: "Боезапас (пусто = стандарт CS2)", rules: "Существующие правила победы и оружия сохраняются; эти значения применяются только к новым матчам.", error: "Не удалось загрузить конфигурацию", ok: "Настройки проверены", saveOk: "Черновик сохранён", publishOk: "Версия отправлена на синхронизацию", rollbackConfirm: "Создать новую версию из выбранной опубликованной конфигурации?", roundQuota: "Квота на раунд", timedRefill: "Пополнение по независимым cooldown", grenade: { HE: "Осколочная", FLASH: "Световая", SMOKE: "Дымовая", INCENDIARY: "Молотов / Incendiary", DECOY: "Decoy" } },
  UA: { title: "Ігрові режими", subtitle: "Чернетки не змінюють активні матчі. Публікація стане активною лише після checksum-підтвердження cs2-1, cs2-2 і cs2-3.", loading: "Завантаження конфігурацій…", enabled: "Режим увімкнено", allMaps: "Усі сумісні мапи", maps: "Мапи", settings: "Параметри", save: "Зберегти чернетку", validate: "Перевірити", publish: "Опублікувати", rollback: "Відкотити до цієї версії", history: "Історія версій", published: "Активна версія", pending: "Синхронізація очікує підтверджень", draft: "Чернетка", synced: "Підтверджено всіма трьома серверами", notSynced: "Немає підтвердження всіх трьох серверів", safetyMissing: "Профіль безпеки мапи ще не перевірено; Low Gravity не можна опублікувати для цієї мапи.", cooldown: "Cooldown відновлення (сек.)", types: "Типи гранат", count: "Доступна кількість", typeCooldown: "Cooldown типу (порожньо = загальний)", weaponPool: "Пул зброї", selectionScope: "Вибір зброї", roundScope: "Щораунду", matchScope: "Один раз за матч", gravity: "Гравітація (% від звичайної)", speed: "Швидкість (% від звичайної)", targetKills: "Ціль за вбивствами", roundTime: "Час раунду (сек.)", maxRounds: "Ліміт раундів", health: "Здоров’я", armor: "Броня", startMoney: "Стартові гроші", maxMoney: "Ліміт грошей", afterRoundMoney: "Гроші після раунду", ammo: "Боєзапас (порожньо = стандарт CS2)", rules: "Поточні правила перемоги та зброї зберігаються; значення діють лише для нових матчів.", error: "Не вдалося завантажити конфігурацію", ok: "Налаштування перевірено", saveOk: "Чернетку збережено", publishOk: "Версію надіслано на синхронізацію", rollbackConfirm: "Створити нову версію з вибраної опублікованої конфігурації?", roundQuota: "Квота на раунд", timedRefill: "Поповнення за незалежними cooldown", grenade: { HE: "Осколкова", FLASH: "Світлова", SMOKE: "Димова", INCENDIARY: "Молотов / Incendiary", DECOY: "Decoy" } },
  EN: { title: "Game modes", subtitle: "Drafts do not change active matches. A publication activates only after checksum acknowledgements from cs2-1, cs2-2 and cs2-3.", loading: "Loading configurations…", enabled: "Mode enabled", allMaps: "All compatible maps", maps: "Maps", settings: "Settings", save: "Save draft", validate: "Validate", publish: "Publish", rollback: "Roll back to this version", history: "Version history", published: "Active version", pending: "Synchronization awaiting acknowledgements", draft: "Draft", synced: "Confirmed by all three servers", notSynced: "Not confirmed by all three servers", safetyMissing: "Map safety profile has not been verified; Low Gravity cannot be published for this map.", cooldown: "Refill cooldown (seconds)", types: "Grenade types", count: "Available count", typeCooldown: "Type cooldown (blank = shared)", weaponPool: "Weapon pool", selectionScope: "Weapon selection", roundScope: "Every round", matchScope: "Once per match", gravity: "Gravity (% of normal)", speed: "Speed (% of normal)", targetKills: "Kill target", roundTime: "Round time (seconds)", maxRounds: "Round limit", health: "Health", armor: "Armor", startMoney: "Starting money", maxMoney: "Money cap", afterRoundMoney: "Money after round", ammo: "Ammunition (blank = CS2 default)", rules: "Existing win and weapon rules are preserved; settings apply only to new matches.", error: "Could not load configuration", ok: "Settings validated", saveOk: "Draft saved", publishOk: "Version submitted for synchronization", rollbackConfirm: "Create a new revision from this published version?", roundQuota: "Round quota", timedRefill: "Independent cooldown refill", grenade: { HE: "HE grenade", FLASH: "Flashbang", SMOKE: "Smoke", INCENDIARY: "Molotov / Incendiary", DECOY: "Decoy" } },
  PL: { title: "Tryby gry", subtitle: "Szkice nie zmieniają aktywnych meczów. Publikacja staje się aktywna dopiero po potwierdzeniu checksum przez cs2-1, cs2-2 i cs2-3.", loading: "Ładowanie konfiguracji…", enabled: "Tryb włączony", allMaps: "Wszystkie zgodne mapy", maps: "Mapy", settings: "Ustawienia", save: "Zapisz szkic", validate: "Sprawdź", publish: "Opublikuj", rollback: "Przywróć tę wersję", history: "Historia wersji", published: "Aktywna wersja", pending: "Synchronizacja oczekuje na potwierdzenia", draft: "Szkic", synced: "Potwierdzono na wszystkich trzech serwerach", notSynced: "Brak potwierdzenia wszystkich trzech serwerów", safetyMissing: "Profil bezpieczeństwa mapy nie jest sprawdzony; Low Gravity nie można opublikować dla tej mapy.", cooldown: "Cooldown uzupełniania (sek.)", types: "Typy granatów", count: "Dostępna liczba", typeCooldown: "Cooldown typu (puste = wspólny)", weaponPool: "Pula broni", selectionScope: "Wybór broni", roundScope: "Każda runda", matchScope: "Raz na mecz", gravity: "Grawitacja (% normalnej)", speed: "Prędkość (% normalnej)", targetKills: "Cel zabójstw", roundTime: "Czas rundy (sek.)", maxRounds: "Limit rund", health: "Zdrowie", armor: "Pancerz", startMoney: "Pieniądze początkowe", maxMoney: "Limit pieniędzy", afterRoundMoney: "Pieniądze po rundzie", ammo: "Amunicja (puste = standard CS2)", rules: "Dotychczasowe zasady zwycięstwa i broni pozostają; ustawienia dotyczą tylko nowych meczów.", error: "Nie udało się pobrać konfiguracji", ok: "Ustawienia sprawdzone", saveOk: "Zapisano szkic", publishOk: "Wersja wysłana do synchronizacji", rollbackConfirm: "Utworzyć nową wersję z wybranej opublikowanej konfiguracji?", roundQuota: "Limit na rundę", timedRefill: "Uzupełnianie niezależnymi cooldownami", grenade: { HE: "Granat HE", FLASH: "Flashbang", SMOKE: "Smoke", INCENDIARY: "Molotov / Incendiary", DECOY: "Decoy" } },
} as const;

const MODE_NAMES: Record<string, Record<string, string>> = {
  RU: { SOLO_1V1: "Classic", AWP_ONLY: "Только AWP", DEAGLE_ONLY: "Только Desert Eagle", KNIFE_ONLY: "Только нож", HEADSHOT_ONLY: "Только в голову", RANDOM_WEAPON: "Случайное оружие", FIRST_TO_10: "До 10 убийств", GRENADE_ONLY: "Только гранаты", LOW_GRAVITY: "Низкая гравитация", SPEED_DUEL: "Дуэль скорости" },
  UA: { SOLO_1V1: "Classic", AWP_ONLY: "Лише AWP", DEAGLE_ONLY: "Лише Desert Eagle", KNIFE_ONLY: "Лише ніж", HEADSHOT_ONLY: "Лише в голову", RANDOM_WEAPON: "Випадкова зброя", FIRST_TO_10: "До 10 вбивств", GRENADE_ONLY: "Лише гранати", LOW_GRAVITY: "Низька гравітація", SPEED_DUEL: "Дуель швидкості" },
  EN: { SOLO_1V1: "Classic", AWP_ONLY: "AWP Only", DEAGLE_ONLY: "Deagle Only", KNIFE_ONLY: "Knife Only", HEADSHOT_ONLY: "Headshot Only", RANDOM_WEAPON: "Random Weapon", FIRST_TO_10: "First to 10", GRENADE_ONLY: "Grenade Only", LOW_GRAVITY: "Low Gravity", SPEED_DUEL: "Speed Duel" },
  PL: { SOLO_1V1: "Classic", AWP_ONLY: "Tylko AWP", DEAGLE_ONLY: "Tylko Desert Eagle", KNIFE_ONLY: "Tylko nóż", HEADSHOT_ONLY: "Tylko w głowę", RANDOM_WEAPON: "Losowa broń", FIRST_TO_10: "Do 10 fragów", GRENADE_ONLY: "Tylko granaty", LOW_GRAVITY: "Niska grawitacja", SPEED_DUEL: "Pojedynek szybkości" },
};

const STATUS_LABELS: Record<string, Record<string, string>> = {
  RU: { PENDING: "Ожидает", STAGED: "Файл подготовлен", APPLIED: "Применено в игре", FAILED: "Ошибка", DRAFT: "Черновик", PENDING_SYNC: "Ожидает серверы", PUBLISHED: "Опубликована", SUPERSEDED: "Предыдущая версия" },
  UA: { PENDING: "Очікує", STAGED: "Файл підготовлено", APPLIED: "Застосовано в грі", FAILED: "Помилка", DRAFT: "Чернетка", PENDING_SYNC: "Очікує сервери", PUBLISHED: "Опублікована", SUPERSEDED: "Попередня версія" },
  EN: { PENDING: "Pending", STAGED: "Staged", APPLIED: "Applied in game", FAILED: "Failed", DRAFT: "Draft", PENDING_SYNC: "Awaiting servers", PUBLISHED: "Published", SUPERSEDED: "Previous version" },
  PL: { PENDING: "Oczekuje", STAGED: "Plik przygotowany", APPLIED: "Zastosowano w grze", FAILED: "Błąd", DRAFT: "Szkic", PENDING_SYNC: "Oczekuje na serwery", PUBLISHED: "Opublikowana", SUPERSEDED: "Poprzednia wersja" },
};

function deepCopy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

export default function GameModeSettings() {
  const { language } = useLanguage();
  const lang = (language in COPY ? language : "EN") as keyof typeof COPY;
  const text = COPY[lang];
  const statusLabel = (status: string) => STATUS_LABELS[lang][status] || status;
  const fieldLabels: Record<string, string> = {
    roundTimeSeconds: text.roundTime, maxRounds: text.maxRounds, targetKills: text.targetKills, health: text.health, armor: text.armor,
    startMoney: text.startMoney, maxMoney: text.maxMoney, afterRoundMoney: text.afterRoundMoney, speedPercent: text.speed, gravityPercent: text.gravity,
  };
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [draft, setDraft] = useState<GameModeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/admin/game-modes", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || text.error);
      const next = data as Bundle;
      setBundle(next);
      const source = next.draft?.config ?? next.pending?.config ?? next.published?.config;
      if (source) setDraft(deepCopy(source));
    } catch (caught) { setError(caught instanceof Error ? caught.message : text.error); }
    finally { setLoading(false); }
  }, [text.error]);

  useEffect(() => { deferEffectTask(() => { void load(); }); }, [load]);

  const modes = useMemo(() => draft ? Object.entries(draft.modes) as [GameModeId, GameModeConfig["modes"][GameModeId]][] : [], [draft]);
  const ackByServer = useMemo(() => new Map((bundle?.acknowledgements || []).map(ack => [ack.serverName, ack])), [bundle]);

  function updateMode(modeId: GameModeId, update: (mode: GameModeConfig["modes"][GameModeId]) => GameModeConfig["modes"][GameModeId]) {
    setDraft(current => {
      if (!current) return current;
      const next = deepCopy(current);
      next.modes[modeId] = update(next.modes[modeId]);
      return next;
    });
  }

  function updateSetting(modeId: GameModeId, key: string, value: unknown) {
    updateMode(modeId, mode => ({ ...mode, settings: { ...mode.settings, [key]: value } }));
  }

  function updateMapSelection(modeId: GameModeId, mapId: string, selected: boolean) {
    if (!bundle || !draft) return;
    const all = bundle.mapCatalog.map(map => map.id);
    updateMode(modeId, mode => {
      const current = new Set(mode.allowedMapIds === null ? all : mode.allowedMapIds);
      if (selected) current.add(mapId); else current.delete(mapId);
      const nextIds = all.filter(id => current.has(id));
      return { ...mode, allowedMapIds: nextIds.length === all.length ? null : nextIds };
    });
  }

  async function action(actionName: "validate" | "saveDraft" | "publishDraft", body: Record<string, unknown> = {}) {
    if (!draft || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/game-modes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: actionName, config: draft, ...body }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const issues = Array.isArray(data.issues) ? data.issues.map((item: { path?: string; message?: string }) => `${item.path}: ${item.message}`).join(" · ") : "";
        throw new Error([data.error || text.error, issues].filter(Boolean).join(" — "));
      }
      if (actionName === "validate") setNotice(text.ok);
      else { setNotice(actionName === "saveDraft" ? text.saveOk : text.publishOk); await load(); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : text.error); }
    finally { setBusy(false); }
  }

  async function rollback(version: number) {
    if (busy || !window.confirm(text.rollbackConfirm)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/game-modes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "rollback", version }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || text.error);
      setNotice(text.publishOk); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : text.error); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="panel rounded-3xl p-8 text-sm text-zinc-500">{text.loading}</div>;
  if (!bundle || !draft) return <div className="panel rounded-3xl p-8 text-sm text-red-300" role="alert">{error || text.error}</div>;
  const pendingVersion = bundle.state.pendingVersion;
  const acked = bundle.requiredServers.filter(name => ["STAGED", "APPLIED"].includes(ackByServer.get(name)?.status || "") && ackByServer.get(name)?.checksum === bundle.pending?.checksum).length;

  return <section className="space-y-5">
    <div className="panel rounded-3xl p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><span className="pill">DUELPLAY · {text.title.toUpperCase()}</span><h1 className="mt-3 text-3xl font-black">{text.title}</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">{text.subtitle}</p></div>
        <div className="rounded-xl border border-white/10 px-4 py-3 text-xs"><div className="text-zinc-500">{text.published}</div><b className="mt-1 block">{bundle.state.publishedVersion ?? "—"}</b></div>
      </div>
      {pendingVersion !== null && <div className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-400/[.04] p-4"><div className="font-bold text-amber-200">{text.pending} · v{pendingVersion} · {acked}/{bundle.requiredServers.length}</div><div className="mt-3 grid gap-2 sm:grid-cols-3">{bundle.requiredServers.map(name => { const ack = ackByServer.get(name); return <div key={name} className="rounded-xl bg-black/20 p-3 text-xs"><b>{name}</b><div className="mt-1 text-zinc-400">{statusLabel(ack?.status || "PENDING")}{ack?.error ? ` · ${ack.error}` : ""}</div></div>; })}</div></div>}
      {pendingVersion === null && bundle.state.publishedVersion !== null && <div className="mt-5 rounded-xl border border-emerald-400/20 bg-emerald-400/[.04] p-3 text-sm text-emerald-200">{text.synced}: v{bundle.state.publishedVersion}</div>}
      {error && <div className="mt-4 rounded-xl border border-red-400/20 bg-red-400/[.04] p-3 text-sm text-red-200" role="alert">{error}</div>}
      {notice && <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-400/[.04] p-3 text-sm text-emerald-200" role="status">{notice}</div>}
      <p className="mt-4 text-xs text-zinc-500">{text.rules}</p>
    </div>

    {modes.map(([modeId, mode]) => {
      const allowed = new Set(mode.allowedMapIds === null ? bundle.mapCatalog.map(map => map.id) : mode.allowedMapIds);
      const settings = mode.settings;
      const grenadeRows = Array.isArray(settings.grenades) ? settings.grenades as Array<{ type: string; count: number; enabled: boolean; cooldownSeconds: number | null }> : [];
      return <article key={modeId} className="panel rounded-3xl p-5 sm:p-6">
        <header className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-black">{MODE_NAMES[lang][modeId] || modeId}</h2><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={mode.enabled} onChange={event => updateMode(modeId, value => ({ ...value, enabled: event.target.checked }))}/>{text.enabled}</label></header>
        <details className="mt-5" open={modeId === "LOW_GRAVITY" || modeId === "SPEED_DUEL"}>
          <summary className="cursor-pointer text-sm font-bold text-zinc-400">{text.maps}</summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{bundle.mapCatalog.map(map => {
            const profile = bundle.mapSafetyProfiles.find(item => item.mapId === map.id);
            const gravitySetting = modeId === "LOW_GRAVITY";
            const canEnable = !gravitySetting || Boolean(profile?.verified);
            return <label key={map.id} className={`rounded-xl border p-3 text-xs ${allowed.has(map.id) ? "border-[var(--theme-accent)]/30 bg-[var(--theme-accent-bg)]" : "border-white/5 bg-black/10"}`}>
              <span className="flex items-start gap-2"><input type="checkbox" checked={allowed.has(map.id)} disabled={!canEnable} onChange={event => updateMapSelection(modeId, map.id, event.target.checked)}/><b>{map.displayName}</b></span>
              {gravitySetting && !profile?.verified && <span className="mt-2 block text-amber-300">{text.safetyMissing}</span>}
            </label>;
          })}</div>
        </details>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(settings).map(([key, value]) => {
            if (key === "grenades" || key === "weaponPool" || key === "gravityPercentByMap" || key === "knifeClassname") return null;
            const label = fieldLabels[key] || key;
            if (typeof value === "boolean") return <label key={key} className="flex items-center gap-2 rounded-xl border border-white/5 p-3 text-sm"><input type="checkbox" checked={value} onChange={event => updateSetting(modeId, key, event.target.checked)}/>{label}</label>;
            if (typeof value === "number" || value === null) return <label key={key} className="text-xs text-zinc-500">{label}<input className="input mt-2" type="number" min={key === "gravityPercent" ? 20 : 0} max={key === "gravityPercent" ? 100 : key === "speedPercent" ? 150 : key.toLowerCase().includes("money") ? 16000 : 600} step="1" value={value ?? ""} placeholder={key.endsWith("Ammo") ? "CS2 default" : undefined} onChange={event => updateSetting(modeId, key, event.target.value === "" ? null : Number(event.target.value))}/></label>;
            if (key === "selectionScope") return <label key={key} className="text-xs text-zinc-500">{text.selectionScope}<select className="input mt-2" value={String(value)} onChange={event => updateSetting(modeId, key, event.target.value)}><option value="MATCH">{text.matchScope}</option><option value="ROUND">{text.roundScope}</option></select></label>;
            if (key === "replenishmentMode") return <label key={key} className="text-xs text-zinc-500">{text.types}<select className="input mt-2" value={String(value)} onChange={event => updateSetting(modeId, key, event.target.value)}><option value="COOLDOWN">{text.timedRefill}</option><option value="ROUND_QUOTA">{text.roundQuota}</option></select></label>;
            return null;
          })}
        </div>
        {modeId === "RANDOM_WEAPON" && <div className="mt-5"><h3 className="mb-2 text-xs font-black uppercase tracking-wider text-zinc-500">{text.weaponPool}</h3><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{bundle.weaponCatalog.map(item => { const pool = Array.isArray(settings.weaponPool) ? settings.weaponPool as string[] : []; return <label key={item.weapon} className="flex items-center gap-2 rounded-lg border border-white/5 p-2 text-xs"><input type="checkbox" checked={pool.includes(item.weapon)} onChange={event => updateSetting(modeId, "weaponPool", event.target.checked ? [...pool, item.weapon] : pool.filter(id => id !== item.weapon))}/><span>{item.weapon.replace("weapon_", "")}</span></label>; })}</div></div>}
        {modeId === "GRENADE_ONLY" && <div className="mt-5"><h3 className="mb-2 text-xs font-black uppercase tracking-wider text-zinc-500">{text.types}</h3><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{grenadeRows.map((grenade, index) => <div key={grenade.type} className="rounded-xl border border-white/5 p-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={grenade.enabled} onChange={event => { const next = grenadeRows.map((item, i) => i === index ? { ...item, enabled: event.target.checked, count: event.target.checked && item.count === 0 ? 1 : item.count } : item); updateSetting(modeId, "grenades", next); }}/>{text.grenade[grenade.type as keyof typeof text.grenade] || grenade.type}</label><div className="mt-3 grid grid-cols-2 gap-2"><label className="text-[10px] text-zinc-500">{text.count}<input type="number" min="0" max="5" className="input mt-1" value={grenade.count} onChange={event => { const next = grenadeRows.map((item, i) => i === index ? { ...item, count: Number(event.target.value) } : item); updateSetting(modeId, "grenades", next); }}/></label><label className="text-[10px] text-zinc-500">{text.typeCooldown}<input type="number" min="1" max="30" className="input mt-1" value={grenade.cooldownSeconds ?? ""} onChange={event => { const next = grenadeRows.map((item, i) => i === index ? { ...item, cooldownSeconds: event.target.value === "" ? null : Number(event.target.value) } : item); updateSetting(modeId, "grenades", next); }}/></label></div></div>)}</div></div>}
        {modeId === "LOW_GRAVITY" && <div className="mt-4 rounded-xl border border-amber-400/15 bg-amber-400/[.03] p-3 text-xs text-amber-200">{text.safetyMissing}</div>}
      </article>;
    })}

    <div className="panel rounded-3xl p-5 sm:p-6"><div className="flex flex-wrap gap-3"><button disabled={busy} onClick={() => void action("validate")} className="rounded-xl border border-white/10 px-4 py-3 text-sm font-bold disabled:opacity-40">{text.validate}</button><button disabled={busy} onClick={() => void action("saveDraft")} className="rounded-xl border border-[var(--theme-accent)]/30 px-4 py-3 text-sm font-bold text-[var(--theme-accent)] disabled:opacity-40">{text.save}</button><button disabled={busy||bundle.state.pendingVersion!==null} onClick={() => void action("publishDraft")} className="rounded-xl bg-[var(--theme-accent)] px-5 py-3 text-sm font-black text-black disabled:opacity-40">{text.publish}</button></div><div className="mt-5"><h3 className="text-sm font-black">{text.history}</h3><div className="mt-2 space-y-2">{bundle.history.map(item => <div key={item.version} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/5 p-3 text-xs"><span>v{item.version} · {statusLabel(item.status)} · {new Date(item.createdAt).toLocaleString()}</span>{item.status==="PUBLISHED"||item.status==="SUPERSEDED"?<button disabled={busy||bundle.state.pendingVersion!==null||item.version===bundle.state.publishedVersion} onClick={()=>void rollback(item.version)} className="rounded-lg border border-white/10 px-3 py-2 disabled:opacity-40">{text.rollback}</button>:null}</div>)}</div></div></div>
  </section>;
}
