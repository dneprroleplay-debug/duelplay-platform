"use client";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getMatches } from "@/lib/api/matches";
import { useLanguage } from "../Common/LanguageContext";
import { useAuth } from "../Common/AuthContext";
import { DUEL_MAPS, getDuelMap } from "@/lib/duel-maps";
import { modeHeaderLabel } from "@/lib/duel-descriptions";
import { formatMatchAmount } from "@/lib/match-currency";
import { siteConfig } from "@/lib/config/site";
import { DiscordIcon } from "../Common/SocialIcons";

type Match={id:string;economyMode:"REAL"|"DEMO";mode:string;weaponModifier?:string|null;mapName:string|null;betAmount:string|number;status:string;playerOneId?:string;playerTwoId?:string|null;game:{title:string};playerOne:{nickname:string;avatarUrl:string|null};playerTwo:{nickname:string;avatarUrl:string|null}|null};
type LobbyMode="waiting"|"active"|"all";
type ActiveMatchSummary={id:string;status:string;economyMode:"REAL"|"DEMO";mapName:string|null;mode:string;weaponModifier:string|null;betAmount:string|number;playerOneId:string|null;playerTwoId:string|null;startedAt:string|null;startDeadlineAt:string|null;liveDeadlineAt:string|null;connectionPhaseCompleted:boolean};

const MAPS=[...new Set(DUEL_MAPS.map(map=>map.serverMapName))];
const MAP_IMAGES:Record<string,string>=Object.fromEntries(DUEL_MAPS.map(map=>[map.serverMapName,map.image]));

export default function Live({refreshKey=0,mode="all",showFilters=false,economy}:{refreshKey?:number;mode?:LobbyMode;showFilters?:boolean;economy?:"REAL"|"DEMO"}){
  const{t,language}=useLanguage();
  const{user}=useAuth();
  const[matches,setMatches]=useState<Match[]>([]); const[loading,setLoading]=useState(true); const[error,setError]=useState(""); const[activeMatchId,setActiveMatchId]=useState<string|null>(null);
  const[myActiveMatch,setMyActiveMatch]=useState<ActiveMatchSummary|null>(null);
  const[manualEconomy,setEconomyMode]=useState<"REAL"|"DEMO">("REAL");
  const economyMode=economy??manualEconomy;
  const[demoEnabled,setDemoEnabled]=useState<boolean|null>(null);
  const[mapFilter,setMapFilter]=useState("ALL"); const[betFilter,setBetFilter]=useState("ALL"); const[visible,setVisible]=useState(6);
  // Identity of the current query. `load` resets pagination only when this key
  // changes, replacing the previous in-effect reset while keeping identical
  // behaviour (reset on mode/economy/refresh change, never on a 10s poll).
  const listQueryKey=`${refreshKey}|${mode}|${economyMode}`;
  const lastListQueryKey=useRef(listQueryKey);
  useEffect(()=>{let disposed=false;fetch("/api/demo-mode",{cache:"no-store"}).then(r=>r.ok?r.json():null).then(d=>{if(!disposed&&d&&typeof d.enabled==="boolean")setDemoEnabled(d.enabled)}).catch(()=>{});return()=>{disposed=true}},[]);
  const load=useCallback(async()=>{try{setError("");const params=new URLSearchParams({economyMode});if(mode==="waiting")params.set("status","waiting");if(mode==="active")params.set("status","active");const [data,busy]=await Promise.all([getMatches(`?${params}`),fetch("/api/matches?mine=active",{cache:"no-store"}).then(r=>r.ok?r.json():null).catch(()=>null)]);if(lastListQueryKey.current!==listQueryKey){lastListQueryKey.current=listQueryKey;setVisible(6)}setMatches(Array.isArray(data)?data:[]);setActiveMatchId(busy?.active?String(busy.match?.id||""):null);setMyActiveMatch(busy?.active?busy.match:null)}catch(e){const code=e instanceof Error?e.message:"";setError(code==="MATCHES_LOAD_ERROR"?t.genericLoadError:code==="AUTH_REQUIRED"?t.loginRequired:t.genericLoadError)}finally{setLoading(false)}},[economyMode,listQueryKey,mode,t]);
  useEffect(()=>{
    let disposed=false; let loadingRef=false;
    const refresh=async()=>{if(disposed||document.visibilityState==='hidden'||loadingRef)return;loadingRef=true;try{await load()}finally{loadingRef=false}};
    void refresh(); const timer=window.setInterval(()=>void refresh(),10000);
    const onVisibility=()=>{if(document.visibilityState==='visible')void refresh()};
    document.addEventListener('visibilitychange',onVisibility);
    return()=>{disposed=true;clearInterval(timer);document.removeEventListener('visibilitychange',onVisibility)};
  },[load]);
  const filtered=useMemo(()=>matches.filter(m=>{const amount=Number(m.betAmount);const mapOk=mapFilter==="ALL"||m.mapName===mapFilter;const betOk=betFilter==="ALL"||(betFilter==="3-10"&&amount>=3&&amount<10)||(betFilter==="10-50"&&amount>=10&&amount<50)||(betFilter==="50+"&&amount>=50);return mapOk&&betOk}),[matches,mapFilter,betFilter]);
  const shown=filtered.slice(0,visible);
  const heading=mode==="active"?(economy==="DEMO"?"LIVE DEMO":t.live):mode==="waiting"?t.matches:t.matchesNow;
  const subtitle=t.liveSubtitle;
  const sectionId=economy?`live-${economy.toLowerCase()}`:"live";
  const demoLabel=language==="RU"?"Демо-кредиты":language==="UA"?"Демо-кредити":language==="PL"?"Kredyty demo":"Demo credits";
  const realLabel=language==="RU"?"Реальные матчи":language==="UA"?"Реальні матчі":language==="PL"?"Mecze REAL":"REAL matches";
  const demoPractice=language==="RU"?"ДЕМО-практика":language==="UA"?"DEMO-практика":language==="PL"?"Praktyka DEMO":"DEMO practice";
  const demoDisabled=language==="RU"?"DEMO-режим временно отключён":language==="UA"?"DEMO-режим тимчасово вимкнено":language==="PL"?"Tryb DEMO jest tymczasowo wyłączony":"DEMO mode is temporarily disabled";
  // The player's own duel must remain reachable from the lobby for every
  // non-terminal lifecycle state (waiting, ready, starting, live). Previously
  // only READY was surfaced, so a match vanished from the player's view the
  // moment it moved to STARTING/LIVE.
  const activeDuelStatuses=["WAITING_FOR_PLAYERS","READY","STARTING","LIVE"];
  const activeStatus=myActiveMatch&&activeDuelStatuses.includes(String(myActiveMatch.status))?String(myActiveMatch.status):null;
  const activeDuelTitle=!activeStatus?null:activeStatus==="READY"
    ?(language==="RU"?"Ваша дуэль готова! Оба игрока на месте.":language==="UA"?"Ваша дуель готова! Обидва гравці на місці.":language==="PL"?"Twój pojedynek jest gotowy! Obaj gracze są na miejscu.":"Your duel is ready! Both players joined.")
    :activeStatus==="LIVE"
      ?(language==="RU"?"Ваша дуэль идёт прямо сейчас.":language==="UA"?"Ваша дуель триває просто зараз.":language==="PL"?"Twój pojedynek trwa teraz.":"Your duel is live right now.")
      :activeStatus==="STARTING"
        ?(language==="RU"?"Сервер вашей дуэли запускается.":language==="UA"?"Сервер вашої дуелі запускається.":language==="PL"?"Serwer pojedynku się uruchamia.":"Your duel server is starting.")
        :(language==="RU"?"Ваша дуэль ожидает второго игрока.":language==="UA"?"Ваша дуель очікує другого гравця.":language==="PL"?"Twój pojedynek czeka na drugiego gracza.":"Your duel is waiting for a second player.");
  const activeDuelCta=activeStatus==="READY"
    ?(language==="RU"?"Открыть матч / Запуск →":language==="UA"?"Відкрити матч / Запуск →":language==="PL"?"Otwórz mecz / Start →":"Open match / Start →")
    :activeStatus==="LIVE"
      ?(language==="RU"?"Вернуться к матчу →":language==="UA"?"Повернутися до матчу →":language==="PL"?"Wróć do meczu →":"Return to match →")
      :(language==="RU"?"Открыть матч →":language==="UA"?"Відкрити матч →":language==="PL"?"Otwórz mecz →":"Open match →");
  return <section id={sectionId} className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
    <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div><span className="pill">{mode==="active"?(economy==="DEMO"?"LIVE DEMO · VIRTUAL CREDITS":"LIVE LOBBY"):"MATCH LOBBY"}</span><h2 className="mt-4 text-4xl font-black">{heading}</h2><p className="mt-2 text-zinc-500">{subtitle}</p>{showFilters&&!economy&&<div className="mt-4 inline-flex rounded-xl border border-white/10 bg-black/30 p-1" role="group" aria-label="Match economy"><button type="button" aria-pressed={economyMode==="REAL"} onClick={()=>setEconomyMode("REAL")} className={`rounded-lg px-3 py-2 text-xs font-bold ${economyMode==="REAL"?"bg-white/15 text-white":"text-zinc-500"}`}>{realLabel}</button><button type="button" aria-pressed={economyMode==="DEMO"} onClick={()=>setEconomyMode("DEMO")} className={`rounded-lg px-3 py-2 text-xs font-bold ${economyMode==="DEMO"?"bg-pink-400/20 text-pink-200":"text-zinc-500"}`}>{demoPractice}</button></div>}{economyMode==="DEMO"&&<><p className="mt-2 text-xs font-bold text-pink-300">{demoLabel}: no monetary value and not withdrawable.</p>{demoEnabled===false?<p className="mt-3 text-xs font-bold text-amber-300">{demoDisabled}</p>:<Link href="/create-demo" className="mt-3 inline-flex rounded-xl bg-pink-400 px-4 py-2 text-sm font-black text-black">Create DEMO practice match</Link>}</>}</div>
      <button onClick={load} className="cursor-pointer rounded-xl border border-white/10 px-4 py-2 text-sm text-zinc-300 transition hover:border-pink-400/30 hover:bg-pink-400/5 hover:text-pink-300 active:scale-95">{t.refresh}</button>
    </div>
    {activeStatus&&myActiveMatch&&<div className="mb-6 flex flex-col gap-3 rounded-2xl border border-pink-400/30 bg-pink-400/[.07] p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><span className="h-3 w-3 animate-pulse rounded-full bg-emerald-400"/><div><b className="text-sm text-pink-200">{activeDuelTitle}</b><p className="mt-0.5 text-xs text-zinc-400"><span data-no-i18n>{myActiveMatch.mapName||"CS2"}</span> · <span data-no-i18n>{modeHeaderLabel(language,myActiveMatch.mode,myActiveMatch.mode)}</span> · {myActiveMatch.economyMode==="DEMO"?"DEMO":"REAL"} · {formatMatchAmount(myActiveMatch.economyMode,myActiveMatch.betAmount)}</p></div></div><Link href={`/matches/${myActiveMatch.id}`} className="inline-flex items-center justify-center rounded-xl bg-pink-400 px-5 py-2.5 text-xs font-black text-black shadow-lg shadow-pink-500/20 transition hover:bg-pink-300">{activeDuelCta}</Link></div>}
    {showFilters&&<div className="mb-7 panel rounded-2xl p-3"><div className="flex flex-wrap gap-2"><Filter active={mapFilter==="ALL"} onClick={()=>{setMapFilter("ALL");setVisible(6)}}>{t.allMaps}</Filter>{MAPS.map(m=>{const label=getDuelMap(m)?.displayName||m;return <Filter key={m} active={mapFilter===m} onClick={()=>{setMapFilter(m);setVisible(6)}}><span data-no-i18n>{label}</span></Filter>})}</div><div className="mt-2 flex flex-wrap gap-2 border-t border-white/5 pt-3"><Filter active={betFilter==="ALL"} onClick={()=>{setBetFilter("ALL");setVisible(6)}}>{economyMode==="REAL"?t.allBets:demoLabel}</Filter>{economyMode==="REAL"&&<><Filter active={betFilter==="3-10"} onClick={()=>{setBetFilter("3-10");setVisible(6)}}>$3–10</Filter><Filter active={betFilter==="10-50"} onClick={()=>{setBetFilter("10-50");setVisible(6)}}>$10–50</Filter><Filter active={betFilter==="50+"} onClick={()=>{setBetFilter("50+");setVisible(6)}}>$50+</Filter></>}</div></div>}
    {loading?<div className="panel p-10 text-center text-zinc-500">{t.loading}</div>:error?<div className="panel border-red-400/20 p-8 text-center text-red-300">{error}</div>:shown.length===0?<div className="panel relative overflow-hidden rounded-3xl border-pink-400/15 p-8 text-center sm:p-12"><div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(244,114,182,.16),transparent_62%)]"/><div className="pointer-events-none absolute -left-20 bottom-0 h-56 w-56 rounded-full bg-pink-400/[.06] blur-3xl"/><div className="pointer-events-none absolute -right-20 top-0 h-56 w-56 rounded-full bg-cyan-400/[.05] blur-3xl"/><div className="relative mx-auto max-w-2xl"><span className="pill">COMMUNITY · 24/7</span><h3 className="mt-4 text-2xl font-black sm:text-3xl">Looking for an opponent right now?</h3><p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-zinc-400">Join our official Discord server to find 1v1 rivals, participate in daily tournaments, and get instant 24/7 match support.</p><div className="mt-6 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center"><a href={siteConfig.socialLinks.discord} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 rounded-xl bg-pink-400 px-5 py-3 text-sm font-black text-black shadow-lg shadow-pink-500/20 transition hover:-translate-y-0.5 hover:bg-pink-300"><DiscordIcon className="h-5 w-5"/>Join Discord Community</a>{mode==="active"&&<Link href="/matches" className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/[.03] px-5 py-3 text-sm font-bold text-zinc-300 transition hover:border-pink-400/30 hover:text-pink-300">{t.openDuels}</Link>}</div><p className="mt-5 text-xs text-zinc-600">{mode==="active"?t.activeNo:t.noMatches} · {mode==="active"?t.activeHint:t.firstMatch}</p></div></div>:<><div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{shown.map((m)=><MatchCard key={m.id} match={m} activeMode={mode==="active"} onJoin={load} activeMatchId={activeMatchId} language={language} demoEnabled={demoEnabled} currentUserId={user?.id}/>)}</div>{visible<filtered.length&&<div className="mt-8 text-center"><button onClick={()=>setVisible(v=>Math.min(v+6,filtered.length))} className="cursor-pointer rounded-2xl border border-white/10 bg-white/[.03] px-6 py-3 font-bold transition hover:border-pink-400/30 hover:bg-pink-400/5 hover:text-pink-300">{t.showMore} · {filtered.length-visible}</button></div>}{visible>6&&<div className="mt-4 flex justify-end"><button onClick={()=>{setVisible(6);document.getElementById(sectionId)?.scrollIntoView({behavior:"smooth",block:"start"})}} className="cursor-pointer rounded-xl border border-white/10 px-4 py-2 text-xs font-bold text-zinc-400 transition hover:border-pink-400/30 hover:bg-pink-400/5 hover:text-pink-200">{t.hide} ↑</button></div>}</>}
  </section>
}

function Filter({active,onClick,children}:{active:boolean;onClick:()=>void;children:React.ReactNode}){return <button data-no-i18n={true} onClick={onClick} className={`cursor-pointer rounded-xl px-3 py-2 text-xs font-bold transition ${active?"bg-pink-400 text-black":"bg-white/[.035] text-zinc-400 hover:bg-white/[.07] hover:text-white"}`}>{children}</button>}

function MatchCard({match,onJoin,activeMode,activeMatchId,language,demoEnabled,currentUserId}:{match:Match;onJoin:()=>void;activeMode:boolean;activeMatchId:string|null;language:string;demoEnabled:boolean|null;currentUserId?:string|null}){
  const{t}=useLanguage();
  const demoDisabled=language==="RU"?"DEMO-режим временно отключён":language==="UA"?"DEMO-режим тимчасово вимкнено":language==="PL"?"Tryb DEMO jest tymczasowo wyłączony":"DEMO mode is temporarily disabled";
  const demoInsufficientBalance=language==="RU"?"Недостаточно виртуальных кредитов DC для ставки.":language==="UA"?"Недостатньо віртуальних кредитів DC для ставки.":language==="PL"?"Za mało wirtualnych кредитов DC na stawkę.":"Not enough virtual DC credits for this stake.";
  const modeText=modeHeaderLabel(language,match.mode,match.mode);const[busy,setBusy]=useState(false);const[loadedImage,setLoadedImage]=useState<string|null>(null);const[msg,setMsg]=useState("");const msgTimer=useRef<number|null>(null);const amount=Number(match.betAmount);const full=Boolean(match.playerTwo);const pot=amount*(full?2:1);const image=MAP_IMAGES[match.mapName||""]||"/images/maps/aim_redline.svg";const imageReady=loadedImage===image;
  const isParticipant=Boolean(currentUserId&&(match.playerOneId===currentUserId||match.playerTwoId===currentUserId||activeMatchId===match.id));
  const isReady=match.status==="READY"||full;
  function showMessage(text:string){if(msgTimer.current)window.clearTimeout(msgTimer.current);setMsg(text);msgTimer.current=window.setTimeout(()=>setMsg(""),5000)}
  useEffect(()=>()=>{if(msgTimer.current)window.clearTimeout(msgTimer.current)},[]);
  async function join(){if(activeMatchId){showMessage("У вас уже есть активная дуэль. Сначала завершите текущую дуэль.");return}if(match.economyMode==="DEMO"&&demoEnabled===false){showMessage(demoDisabled);return}setBusy(true);setMsg("");try{const r=await fetch(`/api/matches/${match.id}/join`,{method:"POST"});const d=await r.json();if(!r.ok){const code=String(d.errorCode||"").toUpperCase();const messages:Record<string,string>={AUTH_REQUIRED:t.loginRequired,OWN_MATCH:t.ownMatch,PLAYER_BUSY:"У вас уже есть активная дуэль. Сначала завершите текущую дуэль.",MATCH_FULL:t.full,INSUFFICIENT_BALANCE:t.walletRequired,JOIN_ERROR:t.joinError};throw new Error(code==="INSUFFICIENT_DEMO_BALANCE"&&match.economyMode==="DEMO"?demoInsufficientBalance:messages[code]||t.joinError)}showMessage(t.bothReady);onJoin()}catch(e){showMessage(e instanceof Error?e.message:t.joinError)}finally{setBusy(false)}}
  const isDemo=match.economyMode==="DEMO";const amountLabel=formatMatchAmount(match.economyMode,amount);
  return <article className="panel group overflow-hidden rounded-2xl border-white/[.07] transition duration-200 hover:-translate-y-1 hover:border-pink-400/30 hover:shadow-[0_18px_60px_rgba(0,0,0,.28)]">
    <Link href={`/matches/${match.id}`} className="block cursor-pointer">
      <div className="relative aspect-[16/9] overflow-hidden bg-zinc-950"><Image
          src={image}
          alt={match.mapName||"CS2 map"}
          fill
          loading="eager"
          decoding="async"
          sizes="(max-width:768px) 100vw,(max-width:1280px) 50vw,33vw"
          onLoad={()=>setLoadedImage(image)}
          onError={()=>setLoadedImage(image)}
          className={`object-cover object-center transition duration-150 group-hover:scale-[1.035] ${imageReady?"opacity-100":"opacity-0"}`}
        /><div className="absolute inset-0 bg-gradient-to-t from-[#080a0e] via-black/10 to-transparent"/>
        <div className="absolute left-4 top-4"><Avatar name={match.playerOne.nickname} url={match.playerOne.avatarUrl}/></div>
        <span className={`absolute right-4 top-4 status ${isReady||activeMode?"live":"waiting"}`}>{match.status==="READY"?t.ready:full?t.ready:activeMode?"LIVE":t.waiting}</span>
        <div className="absolute bottom-4 left-4 right-4"><div className="flex items-center gap-2 text-[10px] uppercase tracking-[.18em] text-pink-300">Counter-Strike 2 {isDemo&&<span className="rounded bg-pink-400/15 px-2 py-1">DEMO · VIRTUAL</span>}</div><div data-no-i18n className="mt-1 text-2xl font-black">{match.mapName}</div><div className="mt-1 text-xs font-medium text-zinc-300"><span data-no-i18n>{match.mapName}</span> • {t.playersLabel||"Игроки"}: {full?"2/2":"1/2"} • <span data-no-i18n>{match.mode==="SOLO_1V1"?"": "1v1 • "}{modeText}</span> • <span data-player-name>{match.playerOne.nickname}</span></div></div>
      </div>
      <div className="p-4"><div className="grid grid-cols-2 gap-3"><Info label={t.game} value={match.game.title}/><Info label={t.bet} value={amountLabel} cyan/></div><div className="mt-3 flex items-center justify-between text-sm"><span className="text-zinc-500">{t.pot}</span><b data-no-i18n>{formatMatchAmount(match.economyMode,pot)}</b></div></div>
    </Link>
    <div className="px-4 pb-4">{isParticipant?<Link href={`/matches/${match.id}`} className="block w-full cursor-pointer rounded-xl bg-pink-400 py-3 text-center text-sm font-black text-black transition hover:bg-pink-300">{match.status==="READY"?(language==="RU"?"Перейти к матчу / Запуск":language==="UA"?"Перейти до матчу / Запуск":language==="PL"?"Przejdź do meczu / Start":"Go to match / Start"):t.openMatch}</Link>:activeMode?<Link href={`/matches/${match.id}`} className="block w-full cursor-pointer rounded-xl bg-white/5 py-3 text-center text-sm font-bold transition hover:bg-pink-400 hover:text-black">{t.openMatch}</Link>:<button onClick={join} disabled={full||busy||Boolean(activeMatchId)} className="w-full cursor-pointer rounded-xl bg-white/5 py-3 text-sm font-bold transition hover:bg-pink-400 hover:text-black active:scale-[.99] disabled:cursor-not-allowed disabled:opacity-40">{busy?t.joining:full?t.full:activeMatchId?"Вы уже в дуэли":t.join}</button>}{msg&&<div data-no-i18n className="mt-3 text-xs text-pink-300">{msg}</div>}</div>
  </article>
}
function Avatar({name,url}:{name:string;url:string|null}){return <div className="grid aspect-square h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-xl border border-white/15 bg-black font-black text-pink-300 backdrop-blur"><img data-player-name src={url||"/avatars/premium/01-cyan.svg"} alt={name} className="avatar-square" onError={e=>{e.currentTarget.src="/avatars/premium/01-cyan.svg"}}/></div>}
function Info({label,value,cyan}:{label:string;value:string;cyan?:boolean}){return <div className="rounded-xl bg-white/[.04] p-3"><div className="text-[11px] text-zinc-500">{label}</div><div data-no-i18n className={`mt-1 truncate font-bold ${cyan?"text-pink-400":""}`}>{value}</div></div>}
