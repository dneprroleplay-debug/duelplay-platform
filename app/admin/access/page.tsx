"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "@/components/Common/ThemeProvider";
import { LegacyAdminPanel } from "@/components/Admin";
import AdminUsersPresence from "@/components/Admin/AdminUsersPresence";
import PermanentAccountDeletion from "@/components/Admin/PermanentAccountDeletion";
import { formatMatchAmount } from "@/lib/match-currency";
import { ADMIN_COMMAND_CATALOG, ADMIN_GROUP_ICONS, type AdminCommand } from "@/lib/admin-commands";

type Role = { code: string; level: number; title: string; description: string; permissions: string[] };
type AccessData = {
  me: { id: string; nickname: string; roleCode: string | null; level: number; permissions: string[] };
  founder: boolean;
  roles: Role[];
  assignments: Array<{ id: string; userId: string; roleCode: string; level: number; user: { id: string; nickname: string; steamId: string | null; role: string; status: string } }>;
  users: Array<{ id: string; nickname: string; steamId: string | null; role: string; status: string }>;
};
type LiveData = {
  counters: { users: number | null; online: number | null; matches24h: number | null; liveMatches: number | null; matchCounts?: { real24h: number; demo24h: number; realLive: number; demoLive: number } | null; servers: number | null; openDisputes: number | null; openFraud: number | null; pendingWithdrawals: number | null; pendingDeposits: number | null };
  activeMatches: Array<{ id: string; status: string; economyMode: "REAL" | "DEMO"; mapName: string | null; betAmount: unknown; createdAt: string; playerOne: { nickname: string }; playerTwo: { nickname: string } | null }>;
};

type Command = AdminCommand;

const ROLE_COLORS: Record<string, string> = {
  SUPERADMIN: "border-pink-400/45 bg-pink-400/[.08]",
  FINANCIAL_ADMIN: "border-emerald-400/30 bg-emerald-400/[.05]",
  ADMIN: "border-sky-400/25 bg-sky-400/[.04]",
  MODERATOR: "border-violet-400/25 bg-violet-400/[.04]",
  SUPPORT: "border-cyan-400/25 bg-cyan-400/[.04]",
  AUDITOR: "border-zinc-400/20 bg-white/[.025]",
  TECH_ADMIN: "border-blue-400/25 bg-blue-400/[.04]",
  CONTENT_ADMIN: "border-fuchsia-400/25 bg-fuchsia-400/[.04]",
  ANALYST: "border-indigo-400/25 bg-indigo-400/[.04]",
  SECURITY_ADMIN: "border-red-400/30 bg-red-400/[.04]",
  FOUNDER: "border-amber-400/60 bg-amber-400/[.07] shadow-[0_0_60px_rgba(245,196,81,.12)]",
};

const COMMANDS: Command[] = [...ADMIN_COMMAND_CATALOG];

const GROUP_ICONS: Record<string,string> = ADMIN_GROUP_ICONS;

function humanRole(code:string){return code.replaceAll("_"," ");}

export default function AdminAccessPage(){
  const router = useRouter();
  const { themePreference } = useTheme();
  const [data,setData]=useState<AccessData|null>(null);
  const [live,setLive]=useState<LiveData|null>(null);
  const [error,setError]=useState(""); const [errorCode,setErrorCode]=useState("");
  const [mfaCode,setMfaCode]=useState("");
  const [mfaSecret,setMfaSecret]=useState("");
  const [mfaUri,setMfaUri]=useState("");
  const [mfaQr,setMfaQr]=useState("");
  const [busy,setBusy]=useState(false);
  const [firstRun,setFirstRun]=useState(()=>{
    if(typeof window==="undefined") return false;
    const key="duelplay:admin-onboarding:v2";
    try{return window.localStorage.getItem(key)!==key}catch{return true}
  });
  const [workspace,setWorkspace]=useState<string|null>(null);
  const [selectedRoleCode,setSelectedRoleCode]=useState<string|null>(null);
  const [command,setCommand]=useState<Command|null>(null);
  const [tick,setTick]=useState(0);
  const [toast,setToast]=useState<string|null>(null);
  const [adminInviteUrl,setAdminInviteUrl]=useState<string|null>(null);
  const [inviteCopyStatus,setInviteCopyStatus]=useState("");

  const loadAccess=useCallback(async()=>{
    try{
      const r=await fetch("/api/admin/access",{cache:"no-store"});
      const j=await r.json().catch(()=>({}));
      if(!r.ok){
        if(r.status===401||j.errorCode==="ADMIN_LOGIN_REQUIRED"){router.push("/admin/login");return null;}
        setErrorCode(j.errorCode||""); setError(j.error||"Доступ запрещён");
        return null;
      }
      setData(j);
      setErrorCode("");setError("");
      return j as AccessData;
    }catch{setError("Не удалось загрузить Admin Center");return null;}
  },[router]);

  const mfaBlocked = errorCode === "ADMIN_MFA_SETUP_REQUIRED" || errorCode === "ADMIN_MFA_REQUIRED" || /mfa/i.test(error);

  const loadLive=useCallback(async()=>{
    // Never poll protected realtime data while the session is waiting for MFA.
    if(errorCode === "ADMIN_MFA_SETUP_REQUIRED" || errorCode === "ADMIN_MFA_REQUIRED" || /mfa/i.test(error)) return;
    try{
      const r=await fetch(`/api/admin/realtime?ts=${Date.now()}`,{cache:"no-store"});
      if(r.status===403){
        const j=await r.json().catch(()=>({}));
        if(j.errorCode==="ADMIN_MFA_SETUP_REQUIRED"||j.errorCode==="ADMIN_MFA_REQUIRED"){
          setErrorCode(j.errorCode);setError(j.error||"Требуется подтверждение MFA администратора");
        }
        return;
      }
      if(!r.ok)return;
      const j=await r.json();
      setLive(j);
    }catch{}
  },[errorCode,error]);

  useEffect(()=>{
    const timer=window.setTimeout(async()=>{const access=await loadAccess();if(access)void loadLive();},0);
    return()=>window.clearTimeout(timer);
  },[loadAccess,loadLive]);
  useEffect(()=>{
    if(mfaBlocked)return;
    const timer=window.setInterval(()=>{void loadLive(); if(workspace||command)setTick(v=>v+1)},3500);
    return()=>window.clearInterval(timer);
  },[loadLive,workspace,command,mfaBlocked]);
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{
      if(e.key==="Escape"){
        e.preventDefault();
        if(command){setCommand(null);setWorkspace("role");}
        else if(workspace){setWorkspace(null);setSelectedRoleCode(null);}
      }
    };
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[command,workspace]);
  useEffect(()=>{
    if(!data)return;
    const me = data.me.roleCode;
    if(me && firstRun===false)return;
  },[data,firstRun]);

  const roleCommands=useCallback((roleCode:string)=>{
    const role=data?.roles.find(r=>r.code===roleCode);
    if(!role)return [] as Command[];
    if(role.permissions.includes("*"))return COMMANDS;
    const set=new Set(role.permissions);
    return COMMANDS.filter(x=>set.has(x.permission)&&(x.permission!=="game_modes.configure"||roleCode==="FOUNDER"||roleCode==="SUPERADMIN"));
  },[data]);
  const available = useMemo(()=>{
    if(!data)return [] as Command[];
    const canConfigureModes=data.me.roleCode==="FOUNDER"||data.me.roleCode==="SUPERADMIN";
    if(data.me.permissions.includes("*"))return COMMANDS.filter(x=>x.permission!=="game_modes.configure"||canConfigureModes);
    const set=new Set(data.me.permissions);
    return COMMANDS.filter(x=>set.has(x.permission)&&(x.permission!=="game_modes.configure"||canConfigureModes));
  },[data]);
  const selectedRole=useMemo(()=>data?.roles.find(r=>r.code===(selectedRoleCode||data?.me.roleCode))||null,[data,selectedRoleCode]);
  const selectedRoleCommands=useMemo(()=>selectedRole?roleCommands(selectedRole.code):available,[selectedRole,roleCommands,available]);
  const groups = useMemo(()=>{
    const map=new Map<string,Command[]>();
    for(const c of available)map.set(c.group,[...(map.get(c.group)||[]),c]);
    return [...map.entries()];
  },[available]);

  function finishFirstRun(){
    try{window.localStorage.setItem("duelplay:admin-onboarding:v2","duelplay:admin-onboarding:v2")}catch{}
    setFirstRun(false);
  }

  async function verifyMfa(){
    setBusy(true);setError("");
    try{
      const r=await fetch("/api/admin/mfa",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"verify",code:mfaCode})});
      const j=await r.json().catch(()=>({}));
      if(!r.ok){setErrorCode(j.errorCode||""); setError(j.error||"Неверный код MFA");return;}
      setMfaCode("");
      setErrorCode("");setError("");
      await loadAccess();
      await loadLive();
    }catch{setError("Не удалось проверить MFA")}finally{setBusy(false)}
  }
  async function setupMfa(){
    setBusy(true);setError("");
    try{
      const r=await fetch("/api/admin/mfa",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"setup"})});
      const j=await r.json().catch(()=>({}));
      if(!r.ok){setErrorCode(j.errorCode||""); setError(j.error||"Не удалось создать MFA");return;}
      setMfaSecret(String(j.secret||""));setMfaUri(String(j.otpauthUri||""));setMfaQr(String(j.qrDataUrl||""));
    }catch{setError("Не удалось создать MFA")}finally{setBusy(false)}
  }

  async function assignRole(userId:string,roleCode:string){
    if(!data)return;
    setBusy(true);setError("");
    setAdminInviteUrl(null);setInviteCopyStatus("");
    try{
      const r=await fetch("/api/admin/access",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId,roleCode})});
      const j=await r.json().catch(()=>({}));
      if(!r.ok){setToast(j.error||"Роль не изменена");return;}
      await loadAccess();
      if(typeof j.adminInviteUrl==="string"&&j.adminInviteUrl){
        setAdminInviteUrl(j.adminInviteUrl);
        setToast(null);
      }else setToast(`Роль ${humanRole(roleCode)} назначена`);
    }catch{setToast("Не удалось изменить роль")}finally{setBusy(false)}
  }
  async function removeRole(userId:string){
    setBusy(true);setError("");
    try{
      const r=await fetch(`/api/admin/access?userId=${encodeURIComponent(userId)}`,{method:"DELETE"});
      const j=await r.json().catch(()=>({}));
      if(!r.ok){setToast(j.error||"Роль не снята");return;}
      await loadAccess();
      setToast("RBAC-назначение снято");
    }catch{setToast("Не удалось снять роль")}finally{setBusy(false)}
  }

  const currentRole = data?.roles.find(r=>r.code===data.me.roleCode) || data?.roles.find(r=>r.code==="SUPERADMIN");
  const roleCards=(data?.roles||[]).slice().sort((a,b)=>a.level-b.level);

  { const mfaNeeds = mfaBlocked || errorCode.startsWith("ADMIN_MFA_") || /mfa/i.test(error);
  if(!data || mfaNeeds){
    return <main className="min-h-[calc(100vh-72px)] bg-black px-4 pb-20 pt-24 text-white"><div className="mx-auto max-w-2xl">{mfaNeeds?<MfaGate error={error} errorCode={errorCode} code={mfaCode} setCode={setMfaCode} secret={mfaSecret} uri={mfaUri} qr={mfaQr} busy={busy} onSetup={setupMfa} onVerify={verifyMfa}/>:<div className="panel rounded-3xl p-8"><div className="text-xs font-black uppercase tracking-[.28em] text-pink-400">DUELPLAY ADMIN</div><h1 className="mt-3 text-3xl font-black">{error||"Загрузка центра управления…"}</h1><p className="mt-3 text-sm text-zinc-500">Проверяем административную сессию и права доступа.</p></div>}</div></main>
  }
  }

  if(firstRun){
    return <main className="fixed inset-0 z-[80] overflow-auto bg-[#050507] text-white"><div className="pointer-events-none absolute inset-0 opacity-50 [background:radial-gradient(circle_at_15%_20%,var(--theme-accent-bg),transparent_35%),radial-gradient(circle_at_85%_75%,rgba(141,255,82,.08),transparent_35%)]"/><div className="relative mx-auto flex min-h-screen max-w-6xl items-center justify-center px-6 py-20"><div className="grid w-full gap-8 lg:grid-cols-[1.05fr_.95fr]"><section className="self-center"><div className="text-xs font-black uppercase tracking-[.3em] text-[var(--theme-accent)]">DUELPLAY ADMIN</div><h1 className="mt-5 text-5xl font-black tracking-tight sm:text-6xl">Добро пожаловать,<br/><span className="text-[var(--theme-accent)]">{data.me.nickname}</span></h1><p className="mt-5 max-w-2xl text-lg leading-8 text-zinc-400">Твой административный центр готов. Здесь собраны только те команды, которые принадлежат твоей роли.</p><div className="mt-8 flex flex-wrap gap-3"><span className="rounded-full border border-[var(--theme-accent)]/30 bg-[var(--theme-accent-bg)] px-4 py-2 text-sm font-black text-[var(--theme-accent)]">{data.me.roleCode} · LEVEL {data.me.level}</span><span className="rounded-full border border-white/10 bg-white/[.03] px-4 py-2 text-sm text-zinc-400">{available.length===COMMANDS.length?"Полный доступ":`${available.length} команд`}</span></div><button autoFocus onClick={finishFirstRun} onKeyDown={e=>{if(e.key==="Enter")finishFirstRun()}} className="mt-10 inline-flex items-center gap-3 rounded-2xl bg-[var(--theme-accent)] px-7 py-4 font-black text-black shadow-[0_0_36px_var(--theme-glow)]">ENTER <span className="text-black/60">→</span></button><p className="mt-3 text-xs text-zinc-600">Enter — продолжить · Esc — не используется на этом экране</p></section><section className="rounded-[32px] border border-white/10 bg-white/[.025] p-4 shadow-2xl"><div className="rounded-[26px] border border-white/8 bg-black/30 p-5"><div className="flex items-center justify-between"><div className="text-xs font-black uppercase tracking-widest text-zinc-600">ТВОИ КОМАНДЫ</div><div className="text-xs text-zinc-600">АКТУАЛЬНО</div></div><div className="mt-4 space-y-2">{groups.map(([name,items])=><div key={name} className="flex items-center justify-between rounded-2xl border border-white/5 bg-white/[.025] p-4"><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--theme-accent-bg)] text-[var(--theme-accent)]">{GROUP_ICONS[name]||"•"}</span><div><b>{name}</b><div className="mt-1 text-xs text-zinc-600">{items.length} команд</div></div></div><span className="text-zinc-700">→</span></div>)}</div></div></section></div></div></main>
  }

  return <main className="min-h-[calc(100vh-72px)] bg-transparent px-4 pb-20 pt-6 text-white sm:px-6 lg:px-8">
    <div className="mx-auto max-w-[1500px]">
      <div className="rounded-[28px] border border-white/8 bg-black/20 p-5 backdrop-blur-xl sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-[var(--theme-accent)]/30 bg-[var(--theme-accent-bg)] px-3 py-1 text-[10px] font-black uppercase tracking-[.22em] text-[var(--theme-accent)]">DUELPLAY ADMIN</span><span className="rounded-full border border-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-[.18em] text-zinc-500">{themePreference}</span></div><h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">Центр управления</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">Выбирай свой уровень, открывай команду на весь экран и работай без перезагрузки страницы.</p></div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            <MiniStat label="Онлайн" value={live?.counters.online}/><MiniStat label="REAL · 24ч" value={live?.counters.matchCounts?.real24h}/><MiniStat label="DEMO · 24ч" value={live?.counters.matchCounts?.demo24h}/><MiniStat label="REAL · LIVE" value={live?.counters.matchCounts?.realLive}/><MiniStat label="DEMO · LIVE" value={live?.counters.matchCounts?.demoLive}/><MiniStat label="Серверы" value={live?.counters.servers}/>
          </div>
        </div>
      </div>

      {(data.me.roleCode==="SUPERADMIN"||data.me.level===999)&&<section className="mt-5 rounded-3xl border border-[var(--theme-accent)]/20 bg-[var(--theme-accent-bg)]/40 p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-[10px] font-black uppercase tracking-[.2em] text-[var(--theme-accent)]">CS2 · ОБСЛУЖИВАНИЕ</div><h2 className="mt-1 text-lg font-black">Автообновление CS2</h2><p className="mt-1 text-xs text-zinc-500">Расписание Europe/Kyiv, здоровье трёх серверов и история запусков.</p></div><a href="/admin/cs2-auto-update" className="rounded-xl bg-[var(--theme-accent)] px-4 py-2.5 text-sm font-black text-black">Открыть настройки →</a></div></section>}

      <section className="mt-6">
        <div className="flex items-end justify-between"><div><div className="text-xs font-black uppercase tracking-[.22em] text-pink-400">УРОВНИ ДОСТУПА</div><h2 className="mt-2 text-2xl font-black">10 уровней + 👑 Founder 999</h2></div><div className="text-xs text-zinc-600">Доступные для просмотра уровни</div></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {roleCards.map(role=>{
            const isMe=role.code===data.me.roleCode;
            const isFounder=role.code==="FOUNDER";
            const clickable=isMe||data.me.roleCode==="FOUNDER";
            return <button key={role.code} type="button" disabled={!clickable} onClick={()=>{if(!clickable)return;setSelectedRoleCode(role.code);setCommand(null);setWorkspace("role")}} className={`group relative overflow-hidden rounded-3xl border p-5 text-left transition ${ROLE_COLORS[role.code]||"border-white/8 bg-white/[.025]"} ${clickable?"cursor-pointer hover:-translate-y-0.5 hover:border-[var(--theme-accent)]/50 hover:shadow-[0_0_40px_var(--theme-glow)]":"cursor-not-allowed opacity-55"}`}>
              <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><span className="text-sm font-black">{isFounder?"👑 ":""}{role.title}</span>{isMe&&<span className="rounded-full bg-[var(--theme-accent)] px-2 py-0.5 text-[9px] font-black text-black">ТЫ</span>}{isFounder&&!data.founder&&<span className="rounded-full border border-amber-400/20 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-amber-300">LOCKED</span>}</div><span className={`text-xs font-black ${isFounder?"text-amber-300":"text-[var(--theme-accent)]"}`}>LEVEL {role.level}</span></div>
              <p className="mt-3 min-h-12 text-sm leading-6 text-zinc-500">{role.description}</p>
              <div className="mt-4 flex items-center justify-between text-xs"><span className="text-zinc-600">{role.permissions.includes("*")?"ALL PERMISSIONS":`${role.permissions.length} команд`}</span><span className={isMe?"text-[var(--theme-accent)]":"text-zinc-700"}>{clickable?"ОТКРЫТЬ →":"🔒"}</span></div>
            </button>
          })}
        </div>
      </section>

      <section className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-3xl border border-white/8 bg-black/20 p-5 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><div className="text-xs font-black uppercase tracking-[.22em] text-[var(--theme-accent)]">{data.me.roleCode} · LEVEL {data.me.level}</div><h2 className="mt-2 text-3xl font-black">Твой рабочий центр</h2><p className="mt-1 text-sm text-zinc-500">Нажми на команду справа. Внутри она открывается на весь экран.</p></div><div className="rounded-2xl border border-white/8 bg-white/[.025] px-4 py-3 text-right"><div className="text-[10px] font-black uppercase tracking-widest text-zinc-600">Доступ</div><div className="mt-1 text-lg font-black">{available.length===COMMANDS.length?"FULL":available.length}</div></div></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {(live?.activeMatches||[]).slice(0,6).map(m=><div key={m.id} className="rounded-2xl border border-white/6 bg-white/[.02] p-4"><div className="flex items-center justify-between gap-2"><span className={`text-[10px] font-black uppercase tracking-widest ${m.status==="LIVE"?"text-emerald-300":"text-zinc-500"}`}>{m.status} · {m.economyMode}</span><span className="text-[10px] text-zinc-600">#{m.id.slice(0,8)}</span></div><div className="mt-3 text-sm font-black"><span data-player-name>{m.playerOne.nickname}</span> <span className="text-[var(--theme-accent)]">VS</span> <span data-player-name>{m.playerTwo?.nickname||"—"}</span></div><div className="mt-2 flex items-center justify-between text-xs text-zinc-500"><span>{m.mapName||"—"}</span><b data-no-i18n className="text-white">{formatMatchAmount(m.economyMode,String(m.betAmount))}</b></div></div>)}
            {!live?.activeMatches?.length&&<div className="sm:col-span-2 xl:col-span-3 rounded-2xl border border-dashed border-white/8 p-10 text-center text-sm text-zinc-600">Активных матчей сейчас нет. Этот блок обновляется автоматически.</div>}
          </div>
        </div>

        <aside className="rounded-3xl border border-white/8 bg-black/20 p-4 sm:p-5 lg:sticky lg:top-24 lg:h-fit">
          <div className="flex items-center justify-between"><div><div className="text-xs font-black uppercase tracking-[.22em] text-[var(--theme-accent)]">ДОСТУПНЫЕ ФУНКЦИИ</div><h3 className="mt-1 text-xl font-black">Доступные функции</h3></div><span className="rounded-full bg-[var(--theme-accent-bg)] px-2.5 py-1 text-[10px] font-black text-[var(--theme-accent)]">{available.length}</span></div>
          <div className="mt-4 max-h-[620px] space-y-4 overflow-auto pr-1">
            {groups.map(([group,items])=><div key={group}><div className="mb-2 flex items-center justify-between px-1"><span className="text-[10px] font-black uppercase tracking-[.2em] text-zinc-600">{GROUP_ICONS[group]||"•"} {group}</span><span className="text-[10px] text-zinc-700">{items.length}</span></div><div className="space-y-1.5">{items.map(c=><button key={c.permission} type="button" onClick={()=>{setSelectedRoleCode(data.me.roleCode||null);setCommand(c);setWorkspace(c.tab||"dashboard")}} className="group flex w-full items-center gap-3 rounded-2xl border border-white/6 bg-white/[.02] p-3 text-left transition hover:border-[var(--theme-accent)]/30 hover:bg-[var(--theme-accent-bg)]"><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${c.danger?"bg-red-400/10 text-red-300":"bg-white/[.035] text-[var(--theme-accent)]"}`}>{c.icon}</span><span className="min-w-0 flex-1"><b className="block truncate text-sm">{c.title}</b><span className="mt-0.5 block truncate text-[10px] text-zinc-600">{c.permission}</span></span><span className="text-zinc-700 transition group-hover:text-[var(--theme-accent)]">→</span></button>)}</div></div>)}
          </div>
          <div className="mt-4 border-t border-white/6 pt-4 text-xs text-zinc-600">Enter — открыть выбранную команду · Esc — закрыть экран</div>
        </aside>
      </section>

    </div>

    {workspace&&<div className="fixed inset-0 z-[100] overflow-hidden bg-[#050507]/[.985] backdrop-blur-2xl"><div className="flex h-full flex-col"><div className="flex min-h-16 shrink-0 items-center justify-between border-b border-white/8 bg-black/70 px-4 sm:px-6"><div className="min-w-0"><div className="flex items-center gap-2"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-300"/><span className="text-[10px] font-black uppercase tracking-[.22em] text-zinc-600">АДМИН-РАЗДЕЛ</span></div><div className="mt-1 truncate text-lg font-black">{command?.title||"Центр управления"}</div></div><div className="flex items-center gap-2"><span className="hidden rounded-xl border border-white/8 px-3 py-2 text-xs text-zinc-500 sm:block">ESC</span><button autoFocus type="button" onClick={()=>{setCommand(null);setWorkspace(null);setSelectedRoleCode(null)}} className="rounded-xl border border-white/10 px-4 py-2 text-sm font-black hover:border-[var(--theme-accent)]/40 hover:text-[var(--theme-accent)]">Закрыть</button></div></div><div className="min-h-0 flex-1 overflow-auto p-3 sm:p-5 lg:p-6"><div className="mx-auto max-w-[1500px]">{workspace==="role"&&!command&&selectedRole?<RoleWorkspace role={selectedRole} commands={selectedRoleCommands} actualRole={data.me.roleCode||"ADMIN"} founder={data.me.roleCode==="FOUNDER"} onCommand={(c)=>{setCommand(c);setWorkspace(c.tab||"dashboard")}}/>:command?.tab==="roles"?<RolesWorkspace data={data} busy={busy} onAssign={assignRole} onRemove={removeRole} onDeleted={loadAccess}/>:command?.tab==="users"&&command?.permission==="users.view"?<AdminUsersPresence isFullPage />:command?.tab==="dashboard"?<RealtimeWorkspace data={live} role={selectedRole?.title||currentRole?.title||data.me.roleCode||"ADMIN"}/>:<LegacyAdminPanel embedded embeddedTab={command?.tab||"dashboard"} refreshKey={tick}/>}</div></div></div></div>}

    {adminInviteUrl&&<div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"><section role="dialog" aria-modal="true" aria-labelledby="admin-invite-title" className="w-full max-w-xl rounded-3xl border border-white/10 bg-[#09090c] p-6 shadow-2xl sm:p-8"><div className="text-xs font-black uppercase tracking-[.22em] text-[var(--theme-accent)]">ПЕРВЫЙ ВХОД</div><h2 id="admin-invite-title" className="mt-3 text-2xl font-black">Ссылка для создания пароля</h2><p className="mt-3 text-sm leading-6 text-zinc-400">Роль назначена. Передай эту персональную ссылку самому пользователю: он создаст собственный пароль для существующего аккаунта. Ссылка одноразовая и действует 30 минут. Пароль тебе не показывается.</p><input aria-label="Ссылка для первого входа" readOnly value={adminInviteUrl} onFocus={e=>e.currentTarget.select()} className="input mt-5"/><p className="mt-2 text-xs text-zinc-600">Скопируй ссылку и передай её лично пользователю. Не публикуй её в общих чатах.</p>{inviteCopyStatus&&<p role="status" className="mt-3 text-sm text-emerald-300">{inviteCopyStatus}</p>}<div className="mt-6 flex flex-wrap justify-end gap-3"><button type="button" onClick={()=>{setAdminInviteUrl(null);setInviteCopyStatus("")}} className="rounded-xl border border-white/10 px-4 py-3 text-sm font-bold text-zinc-300">Закрыть</button><button type="button" onClick={async()=>{try{await navigator.clipboard.writeText(adminInviteUrl);setInviteCopyStatus("Ссылка скопирована.")}catch{setInviteCopyStatus("Автокопирование недоступно. Выдели ссылку выше и скопируй её вручную.")}}} className="rounded-xl bg-[var(--theme-accent)] px-5 py-3 text-sm font-black text-black">Копировать ссылку</button></div></section></div>}

    {toast&&<div className="fixed right-4 top-20 z-[130] w-[min(420px,calc(100vw-2rem))]"><div className="rounded-2xl border border-red-400/25 bg-[#11070c]/95 p-4 shadow-2xl backdrop-blur-xl"><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-red-400/10 text-red-300">!</span><div className="flex-1"><b>Операция</b><p className="mt-1 text-sm leading-5 text-zinc-400">{toast}</p></div><button onClick={()=>setToast(null)} className="text-zinc-600 hover:text-white">×</button></div></div></div>}
  </main>
}

function RoleWorkspace({role,commands,actualRole,founder,onCommand}:{role:Role;commands:Command[];actualRole:string;founder:boolean;onCommand:(c:Command)=>void}){
  return <div className="rounded-[28px] border border-white/8 bg-black/20 p-5 sm:p-8">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div><div className="text-xs font-black uppercase tracking-[.25em] text-[var(--theme-accent)]">LEVEL {role.level}</div><h2 className="mt-2 text-4xl font-black">{role.title}</h2><p className="mt-2 max-w-3xl text-zinc-500">{role.description}</p></div><div className="rounded-2xl border border-white/8 bg-white/[.025] px-4 py-3 text-sm"><div className="text-[10px] font-black uppercase tracking-widest text-zinc-600">Текущий доступ</div><div className="mt-1 font-black text-[var(--theme-accent)]">{actualRole}</div></div></div>
    {founder&&role.code!==actualRole&&<div className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-400/[.04] p-4 text-sm leading-6 text-amber-100/80">Вы просматриваете структуру выбранного уровня. Ваши фактические права остаются правами Founder.</div>}
    <div className="mt-7 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{commands.map(c=><button key={c.permission} type="button" onClick={()=>onCommand(c)} className="group rounded-2xl border border-white/7 bg-white/[.025] p-4 text-left transition hover:-translate-y-0.5 hover:border-[var(--theme-accent)]/40 hover:bg-[var(--theme-accent-bg)]"><div className="flex items-start gap-3"><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${c.danger?"bg-red-400/10 text-red-300":"bg-[var(--theme-accent-bg)] text-[var(--theme-accent)]"}`}>{c.icon}</span><span className="min-w-0 flex-1"><b className="block">{c.title}</b><span className="mt-1 block text-xs leading-5 text-zinc-500">{c.description}</span></span><span className="text-zinc-700 group-hover:text-[var(--theme-accent)]">→</span></div></button>)}{!commands.length&&<div className="col-span-full rounded-2xl border border-dashed border-white/8 p-8 text-center text-sm text-zinc-600">Для этого уровня пока нет назначенных команд в текущей системе.</div>}</div>
  </div>
}

function MiniStat({label,value}:{label:string;value:number|null|undefined}){return <div className="rounded-2xl border border-white/8 bg-white/[.025] px-3 py-2.5"><div className="text-[9px] font-black uppercase tracking-widest text-zinc-600">{label}</div><div className="mt-1 text-lg font-black">{value??"—"}</div></div>}

function MfaGate({error,errorCode,code,setCode,secret,uri,qr,busy,onSetup,onVerify}:{error:string;errorCode:string;code:string;setCode:(v:string)=>void;secret:string;uri:string;qr:string;busy:boolean;onSetup:()=>void;onVerify:()=>void}){
  const setup=errorCode==="ADMIN_MFA_SETUP_REQUIRED" || (!secret && /настроить|setup|required/i.test(error));
  return <div className="panel rounded-[32px] p-6 sm:p-8"><div className="text-xs font-black uppercase tracking-[.25em] text-[var(--theme-accent)]">DUELPLAY ADMIN SECURITY</div><h1 className="mt-3 text-3xl font-black">Защищённый вход</h1><p className="mt-2 text-sm leading-6 text-zinc-500">Админка требует подтверждение MFA. После ввода кода достаточно нажать Enter.</p>{error&&<div className="mt-5 rounded-2xl border border-red-400/20 bg-red-400/[.04] p-4 text-sm text-red-300">{error}</div>}{setup&&!secret?<button autoFocus onClick={onSetup} disabled={busy} className="mt-6 w-full rounded-2xl bg-[var(--theme-accent)] py-3 font-black text-black disabled:opacity-40">{busy?"Создание…":"Создать MFA"}</button>:<form onSubmit={e=>{e.preventDefault();if(code.length===6&&!busy)onVerify()}}><>{secret&&<div className="mt-5 space-y-3">{qr&&<div className="flex flex-col items-center rounded-2xl border border-white/10 bg-white p-4"><img src={qr} alt="QR-код для Google Authenticator" className="h-56 w-56"/><p className="mt-2 text-center text-xs text-zinc-700">Сканируй в Google Authenticator</p></div>}<div><div className="mb-2 flex items-center justify-between gap-3"><span className="text-[10px] font-black uppercase tracking-widest text-zinc-600">Секрет</span><button type="button" onClick={()=>void navigator.clipboard.writeText(secret)} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-zinc-300 hover:bg-white/5">Копировать ключ</button></div><code className="block overflow-auto rounded-xl bg-black p-3 text-sm text-white">{secret}</code></div><div><div className="mb-2 flex items-center justify-between gap-3"><span className="text-[10px] font-black uppercase tracking-widest text-zinc-600">OTPAUTH URI</span><button type="button" onClick={()=>void navigator.clipboard.writeText(uri)} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-zinc-300 hover:bg-white/5">Копировать URI</button></div><code className="block max-h-28 overflow-auto rounded-xl bg-black p-3 text-xs text-zinc-400">{uri}</code><p className="mt-2 text-xs leading-5 text-zinc-500">Добавь секрет вручную в Google Authenticator, если сканирование QR недоступно. Не отправляй секрет посторонним.</p></div></div>}<label className="mt-6 block"><span className="mb-2 block text-xs font-black uppercase tracking-widest text-zinc-500">Код из приложения</span><input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="input text-center text-3xl tracking-[.5em]" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,"").slice(0,6))} placeholder="000000"/></label><button type="submit" disabled={busy||code.length!==6} className="mt-5 w-full rounded-2xl bg-[var(--theme-accent)] py-3 font-black text-black disabled:opacity-40">{busy?"Проверка…":"Подтвердить MFA · ENTER"}</button></></form>}</div>
}

function RealtimeWorkspace({data,role}:{data:LiveData|null;role:string}){return <div className="rounded-[28px] border border-white/8 bg-black/20 p-5 sm:p-8"><div className="text-xs font-black uppercase tracking-[.25em] text-[var(--theme-accent)]">{role}</div><h2 className="mt-2 text-4xl font-black">Обзор в реальном времени</h2><p className="mt-2 text-zinc-500">Данные панели поддерживаются в актуальном состоянии.</p><div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{["users","online","matches24h","liveMatches"].map((k)=><div key={k} className="rounded-2xl border border-white/6 bg-white/[.025] p-5"><div className="text-[10px] font-black uppercase tracking-widest text-zinc-600">{k==="matches24h"?"matches24h · REAL+DEMO":k==="liveMatches"?"liveMatches · REAL+DEMO":k}</div><div className="mt-2 text-3xl font-black">{(k==="users"?data?.counters.users:k==="online"?data?.counters.online:k==="matches24h"?data?.counters.matches24h:data?.counters.liveMatches)??"—"}</div></div>)}</div><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[["REAL · 24ч",data?.counters.matchCounts?.real24h],["DEMO · 24ч",data?.counters.matchCounts?.demo24h],["REAL · LIVE",data?.counters.matchCounts?.realLive],["DEMO · LIVE",data?.counters.matchCounts?.demoLive]].map(([label,value])=><div key={String(label)} className="rounded-2xl border border-white/6 bg-white/[.025] p-4"><div className="text-[10px] font-black uppercase tracking-widest text-zinc-600">{label}</div><div className="mt-2 text-2xl font-black">{value??"—"}</div></div>)}</div><div className="mt-7"><div className="mb-3 text-sm font-black">Активные матчи</div><div className="grid gap-3 md:grid-cols-2">{(data?.activeMatches||[]).map(m=><div key={m.id} className="rounded-2xl border border-white/6 bg-white/[.02] p-4"><div className="flex items-center justify-between"><span className="text-[10px] font-black uppercase tracking-widest text-emerald-300">{m.status} · {m.economyMode}</span><span className="text-[10px] text-zinc-700">#{m.id.slice(0,8)}</span></div><div className="mt-3 font-black">{m.playerOne.nickname} <span className="text-[var(--theme-accent)]">VS</span> {m.playerTwo?.nickname||"—"}</div><div className="mt-2 text-xs text-zinc-600">{m.mapName||"—"} · <span data-no-i18n>{formatMatchAmount(m.economyMode,String(m.betAmount))}</span></div></div>)}{!data?.activeMatches?.length&&<div className="rounded-2xl border border-dashed border-white/8 p-10 text-center text-sm text-zinc-600">Активных матчей нет.</div>}</div></div></div>}

function RolesWorkspace({data,busy,onAssign,onRemove,onDeleted}:{data:AccessData;busy:boolean;onAssign:(u:string,r:string)=>void;onRemove:(u:string)=>void;onDeleted:()=>Promise<unknown>}){
  const [userId,setUserId]=useState(""); const [role,setRole]=useState("ADMIN"); const [deleteUser,setDeleteUser]=useState<{id:string;nickname:string}|null>(null); const [deleteNotice,setDeleteNotice]=useState("");
  const canManage=data.me.permissions.includes("*")||(data.me.permissions.includes("roles.manage")&&data.me.permissions.includes("roles.assign"));
  return <div className="rounded-[28px] border border-white/8 bg-black/20 p-5 sm:p-8"><div className="text-xs font-black uppercase tracking-[.25em] text-[var(--theme-accent)]">ADMINISTRATION</div><h2 className="mt-2 text-4xl font-black">Управление ролями</h2><p className="mt-2 text-zinc-500">RBAC назначается здесь. Founder не является обычной назначаемой ролью.</p>{canManage&&<div className="mt-7 grid gap-3 lg:grid-cols-[1fr_280px_auto]"><select value={userId} onChange={e=>setUserId(e.target.value)} className="input"><option value="">Выберите пользователя…</option>{data.users.filter(u=>u.id!==data.me.id).map(u=><option key={u.id} value={u.id}>{u.nickname} · {u.role}</option>)}</select><select value={role} onChange={e=>setRole(e.target.value)} className="input">{data.roles.filter(r=>r.code!=="FOUNDER").map(r=><option key={r.code}>{r.code}</option>)}</select><button disabled={!userId||busy} onClick={()=>onAssign(userId,role)} className="rounded-2xl bg-[var(--theme-accent)] px-5 py-3 font-black text-black disabled:opacity-40">Назначить · ENTER</button></div>}
  {deleteNotice&&<div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3 text-sm text-emerald-200">{deleteNotice}</div>}
  {data.me.roleCode==="FOUNDER"&&data.me.level===999&&<section className="mt-8 rounded-3xl border border-red-400/20 bg-red-500/[.025] p-4 sm:p-5"><div><div className="text-xs font-black uppercase tracking-[.2em] text-red-300">ОПАСНЫЕ ОПЕРАЦИИ · LEVEL 999</div><h3 className="mt-2 text-2xl font-black">Аккаунты пользователей</h3><p className="mt-1 text-sm text-zinc-500">Удаление доступно только владельцу. Сначала будет выполнена проверка балансов, матчей, споров и финансовых операций.</p></div><div className="mt-4 overflow-x-auto rounded-2xl border border-white/8"><table className="w-full min-w-[850px] text-sm"><thead className="bg-white/[.03] text-left text-zinc-600"><tr><th className="p-3">Никнейм</th><th className="p-3">Внутренний ID</th><th className="p-3">Steam</th><th className="p-3">Роль</th><th className="p-3">Статус</th><th className="p-3">Действие</th></tr></thead><tbody>{data.users.map(u=><tr key={u.id} className="border-t border-white/6"><td className="p-3 font-bold">{u.nickname}</td><td className="p-3 font-mono text-xs text-zinc-500">{u.id}</td><td className="p-3">{u.steamId?"Привязан":"—"}</td><td className="p-3">{u.role}</td><td className="p-3 text-zinc-500">{u.status}</td><td className="p-3"><button type="button" disabled={busy||u.id===data.me.id} onClick={()=>{setDeleteNotice("");setDeleteUser({id:u.id,nickname:u.nickname})}} className="rounded-xl border border-red-400/30 px-3 py-2 text-xs font-black text-red-200 hover:bg-red-500/10 disabled:opacity-30">Удалить аккаунт навсегда</button></td></tr>)}</tbody></table></div></section>}
  {deleteUser&&<PermanentAccountDeletion userId={deleteUser.id} onClose={()=>setDeleteUser(null)} onSuccess={async()=>{setDeleteUser(null);setDeleteNotice(`Аккаунт ${deleteUser.nickname} анонимизирован, сессии и токены отозваны; аудит сохранён.`);await onDeleted()}}/>}
  <div className="mt-8 overflow-x-auto rounded-3xl border border-white/8"><table className="w-full min-w-[760px] text-sm"><thead className="bg-white/[.03] text-left text-zinc-600"><tr><th className="p-4">Пользователь</th><th className="p-4">RBAC</th><th className="p-4">Level</th><th className="p-4">Статус</th><th className="p-4">Действие</th></tr></thead><tbody>{data.assignments.map(a=><tr key={a.id} className="border-t border-white/6"><td className="p-4 font-bold">{a.user.nickname}</td><td className="p-4 text-[var(--theme-accent)]">{a.roleCode}</td><td className="p-4">{a.level}</td><td className="p-4 text-zinc-600">{a.user.status}</td><td className="p-4"><button disabled={busy||a.userId===data.me.id} onClick={()=>onRemove(a.userId)} className="rounded-xl border border-red-400/20 px-3 py-2 text-xs font-bold text-red-300 disabled:opacity-30">Снять RBAC</button></td></tr>)}{!data.assignments.length&&<tr><td className="p-10 text-center text-zinc-600" colSpan={5}>Назначений нет. Для legacy-ролей используется базовая роль пользователя.</td></tr>}</tbody></table></div></div>
}
