"use client";
import Link from "next/link";
import {useEffect,useState,useRef} from "react";
import {useLanguage} from "../Common/LanguageContext";
import {useRouter} from "next/navigation";
import {languages} from "../../lib/language";
import {useAuth} from "../Common/AuthContext";

const FLAGS:{key:keyof typeof languages;name:string;src:string}[]=[
 {key:"RU",name:"Русский",src:"/images/flags/ru.svg"},
 {key:"UA",name:"Українська",src:"/images/flags/ua.svg"},
 {key:"EN",name:"English",src:"/images/flags/en.svg"},
 {key:"PL",name:"Polski",src:"/images/flags/pl.svg"}
];
type Notice={id:string;type:string;title:string;body:string;createdAt:string;status:string};

export default function Header(){
 const{language,setLanguage,t}=useLanguage(); const{user,loading,logout}=useAuth(); const router=useRouter();
 const[langOpen,setLangOpen]=useState(false),[menuOpen,setMenuOpen]=useState(false),[profileOpen,setProfileOpen]=useState(false),[noticeOpen,setNoticeOpen]=useState(false);
 const[notices,setNotices]=useState<Notice[]>([]),[unread,setUnread]=useState(0);
 const langRef=useRef<HTMLDivElement>(null),noticeRef=useRef<HTMLDivElement>(null),profileRef=useRef<HTMLDivElement>(null);
 async function loadNotices(){if(!user){setNotices([]);setUnread(0);return}try{const r=await fetch("/api/notifications",{cache:"no-store"});const d=await r.json();setNotices(d.notifications??[]);setUnread(Number(d.unread||0))}catch{}}
 useEffect(()=>{void loadNotices();const timer=window.setInterval(()=>void loadNotices(),10000);return()=>window.clearInterval(timer)},[user?.id]);
 useEffect(()=>{const close=(e:MouseEvent)=>{const target=e.target as Node;if(langRef.current?.contains(target)||noticeRef.current?.contains(target)||profileRef.current?.contains(target))return;setLangOpen(false);setNoticeOpen(false);setProfileOpen(false)};const key=(e:KeyboardEvent)=>{if(e.key==="Escape"){setLangOpen(false);setNoticeOpen(false);setProfileOpen(false);setMenuOpen(false)}};document.addEventListener("click",close);window.addEventListener("keydown",key);return()=>{document.removeEventListener("click",close);window.removeEventListener("keydown",key)}},[]);
 async function markNotice(id:string){await fetch("/api/notifications",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id})});setNotices(v=>v.map(n=>n.id===id?{...n,status:"READ"}:n));setUnread(v=>Math.max(0,v-1));setNoticeOpen(false)}
 async function markAll(){await fetch("/api/notifications",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({all:true})});setNotices(v=>v.map(n=>({...n,status:"READ"})));setUnread(0);setNoticeOpen(false)}
  const noticePayload=(n:Notice)=>((n as any).payload||{}) as Record<string,any>;
 const noticeTitle=(n:Notice)=>{
  const p=noticePayload(n);
  const kind=p.kind;
  if(p.localTest===true){
   return Number(p.payout||0)>0
    ? language==="RU"?"Победа в тестовой дуэли":language==="UA"?"Перемога в тестовій дуелі":language==="PL"?"Wygrana w testowym pojedynku":"Test duel won"
    : language==="RU"?"Тестовый матч завершён":language==="UA"?"Тестовий матч завершено":language==="PL"?"Testowy mecz zakończony":"Test match completed";
  }
  if(kind==="SUPPORT_CLOSED")return language==="RU"?"Обращение закрыто":language==="UA"?"Звернення закрито":language==="PL"?"Zgłoszenie zamknięte":"Ticket closed";
  if(kind==="SUPPORT_REPLY")return language==="RU"?"Ответ поддержки":language==="UA"?"Відповідь підтримки":language==="PL"?"Odpowiedź wsparcia":"Support reply";
  const titles:any={
    RU:{
      SYSTEM:"Системное уведомление",
      MATCH_FOUND:"Найден матч",
      MATCH_READY:"Матч готов",
      TRANSACTION_SUCCESS:"Операция выполнена",
      TRANSACTION_FAILED:"Операция не выполнена",
      DISPUTE_UPDATE:"Обновление спора",
      PROMO_ACTIVATED:"Промокод активирован",
      ACHIEVEMENT_UNLOCKED:"Достижение разблокировано",
      SECURITY_ALERT:"Оповещение безопасности"
    },
    UA:{
      SYSTEM:"Системне сповіщення",
      MATCH_FOUND:"Матч знайдено",
      MATCH_READY:"Матч готовий",
      TRANSACTION_SUCCESS:"Операцію виконано",
      TRANSACTION_FAILED:"Операцію не виконано",
      DISPUTE_UPDATE:"Оновлення спору",
      PROMO_ACTIVATED:"Промокод активовано",
      ACHIEVEMENT_UNLOCKED:"Досягнення розблоковано",
      SECURITY_ALERT:"Сповіщення безпеки"
    },
    EN:{
      SYSTEM:"System notification",
      MATCH_FOUND:"Match found",
      MATCH_READY:"Match ready",
      TRANSACTION_SUCCESS:"Transaction successful",
      TRANSACTION_FAILED:"Transaction failed",
      DISPUTE_UPDATE:"Dispute update",
      PROMO_ACTIVATED:"Promo activated",
      ACHIEVEMENT_UNLOCKED:"Achievement unlocked",
      SECURITY_ALERT:"Security alert"
    },
    PL:{
      SYSTEM:"Powiadomienie systemowe",
      MATCH_FOUND:"Znaleziono mecz",
      MATCH_READY:"Mecz gotowy",
      TRANSACTION_SUCCESS:"Transakcja zakończona",
      TRANSACTION_FAILED:"Transakcja nieudana",
      DISPUTE_UPDATE:"Aktualizacja sporu",
      PROMO_ACTIVATED:"Kod promocyjny aktywowany",
      ACHIEVEMENT_UNLOCKED:"Osiągnięcie odblokowane",
      SECURITY_ALERT:"Alert bezpieczeństwa"
    }
  };

  return titles[language]?.[n.type] || n.title;
  };
 const noticeBody=(n:Notice)=>{
  const p=noticePayload(n);
  const kind=p.kind;
  if(p.localTest===true){
   if(Number(p.payout||0)>0){
    const amount=Number(p.payout).toFixed(2);
    return language==="RU"?`Тестовый матч завершён. Начислено ${amount}.`:language==="UA"?`Тестовий матч завершено. Зараховано ${amount}.`:language==="PL"?`Testowy mecz zakończony. Dodano ${amount}.`:`Test match completed. ${amount} credited.`;
   }
   return language==="RU"?"Победитель выбран в локальном тестовом режиме.":language==="UA"?"Переможця обрано в локальному тестовому режимі.":language==="PL"?"Zwycięzca został wybrany w trybie lokalnego testu.":"Winner selected in local test mode.";
  }
  if(kind==="SUPPORT_CLOSED"){
   const subject=p.subject||"";
   return language==="RU"?`Обращение «${subject}» закрыто поддержкой.`:language==="UA"?`Звернення «${subject}» закрито підтримкою.`:language==="PL"?`Zgłoszenie „${subject}” zostało zamknięte przez wsparcie.`:`Ticket “${subject}” was closed by support.`;
  }
  const bodies:any={
    RU:{
      SYSTEM:"Системное уведомление DuelPlay.",
      MATCH_FOUND:"Для тебя найден подходящий матч.",
      MATCH_READY:"Матч готов к запуску.",
      TRANSACTION_SUCCESS:"Операция успешно выполнена.",
      TRANSACTION_FAILED:"Операция не выполнена.",
      DISPUTE_UPDATE:"Есть обновление по спору.",
      PROMO_ACTIVATED:"Промокод успешно активирован.",
      ACHIEVEMENT_UNLOCKED:"Новое достижение разблокировано.",
      SECURITY_ALERT:"Обнаружено важное событие безопасности."
    },
    UA:{
      SYSTEM:"Системне сповіщення DuelPlay.",
      MATCH_FOUND:"Для тебе знайдено відповідний матч.",
      MATCH_READY:"Матч готовий до запуску.",
      TRANSACTION_SUCCESS:"Операцію успішно виконано.",
      TRANSACTION_FAILED:"Операцію не виконано.",
      DISPUTE_UPDATE:"Є оновлення щодо спору.",
      PROMO_ACTIVATED:"Промокод успішно активовано.",
      ACHIEVEMENT_UNLOCKED:"Нове досягнення розблоковано.",
      SECURITY_ALERT:"Виявлено важливу подію безпеки."
    },
    EN:{
      SYSTEM:"DuelPlay system notification.",
      MATCH_FOUND:"A suitable match has been found for you.",
      MATCH_READY:"The match is ready to start.",
      TRANSACTION_SUCCESS:"The transaction was completed successfully.",
      TRANSACTION_FAILED:"The transaction failed.",
      DISPUTE_UPDATE:"There is an update on your dispute.",
      PROMO_ACTIVATED:"The promo code was activated successfully.",
      ACHIEVEMENT_UNLOCKED:"A new achievement was unlocked.",
      SECURITY_ALERT:"An important security event was detected."
    },
    PL:{
      SYSTEM:"Powiadomienie systemowe DuelPlay.",
      MATCH_FOUND:"Znaleziono odpowiedni mecz.",
      MATCH_READY:"Mecz jest gotowy do rozpoczęcia.",
      TRANSACTION_SUCCESS:"Transakcja została pomyślnie zakończona.",
      TRANSACTION_FAILED:"Transakcja nie powiodła się.",
      DISPUTE_UPDATE:"Dostępna jest aktualizacja sporu.",
      PROMO_ACTIVATED:"Kod promocyjny został aktywowany.",
      ACHIEVEMENT_UNLOCKED:"Odblokowano nowe osiągnięcie.",
      SECURITY_ALERT:"Wykryto ważne zdarzenie bezpieczeństwa."
    }
  };

  return bodies[language]?.[n.type] || n.body;
   }; const ui={
  RU:{notifications:"Уведомления",readAll:"Прочитать всё",empty:"Пока нет уведомлений",profile:"Профиль",wallet:"Кошелёк",inventory:"Инвентарь",appearance:"Оформление",admin:"Панель администратора",logout:t.logout},
  UA:{notifications:"Сповіщення",readAll:"Прочитати все",empty:"Поки немає сповіщень",profile:"Профіль",wallet:"Гаманець",inventory:"Інвентар",appearance:"Оформлення",admin:"Панель адміністратора",logout:t.logout},
  EN:{notifications:"Notifications",readAll:"Mark all as read",empty:"No notifications yet",profile:"Profile",wallet:"Wallet",inventory:"Inventory",appearance:"Appearance",admin:"Admin panel",logout:t.logout},
  PL:{notifications:"Powiadomienia",readAll:"Oznacz wszystko jako przeczytane",empty:"Brak powiadomień",profile:"Profil",wallet:"Portfel",inventory:"Ekwipunek",appearance:"Wygląd",admin:"Panel administratora",logout:t.logout}
 }[language];
 const current=FLAGS.find(x=>x.key===language)||FLAGS[0];
 const navClass="cursor-pointer rounded-lg px-2 py-1.5 text-sm text-zinc-400 transition hover:bg-[var(--theme-accent-bg)] hover:text-[var(--theme-accent)]";
 const closeMenus=()=>{setLangOpen(false);setNoticeOpen(false);setProfileOpen(false);setMenuOpen(false)};
 const goHome=(e:React.MouseEvent<HTMLAnchorElement>)=>{e.preventDefault();closeMenus();router.push(`/?intro=${Date.now()}`)};
 const links=<><Link className={navClass} href="/" onClick={goHome}>{t.home}</Link><Link className={navClass} href="/matches" onClick={closeMenus}>{t.matches}</Link><Link className={navClass} href="/live" onClick={closeMenus}><span className="inline-flex items-center gap-2"><span className="site-live-dot"/>{t.live}</span></Link><Link className={navClass} href="/cases" onClick={closeMenus}>{t.casesNav}</Link><Link className={navClass} href="/rating" onClick={closeMenus}>{t.rating}</Link><Link className={navClass} href="/profile" onClick={closeMenus}>{t.profile}</Link></>;
 const avatar=user?.avatarUrl||user?.steamAvatarUrl;
 const anyOpen=langOpen||noticeOpen||profileOpen;
 return <>
  {anyOpen&&<button aria-label="Закрыть меню" className="fixed inset-0 z-[45] cursor-default bg-transparent" onClick={closeMenus}/>}
  <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-[#050507]/90 backdrop-blur-xl">
   <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
    <div className="flex items-center gap-2"><button className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 md:hidden" aria-label="Menu" onClick={()=>setMenuOpen(v=>!v)}>{menuOpen?"×":"☰"}</button><Link href="/" onClick={goHome} className="flex items-center gap-2 font-black tracking-tight transition hover:opacity-90"><span className="grid h-11 w-11 shrink-0 place-items-center overflow-visible"><img src="/branding/duelplay-logo-transparent.png" alt="DuelPlay" className="h-10 w-10 object-contain"/></span><span className="hidden text-xl tracking-[-.03em] sm:block">DUEL<span className="text-[var(--theme-accent)]">PLAY</span></span></Link></div>
    <nav className="hidden items-center gap-3 text-sm md:flex">{links}</nav>
    <div className="flex items-center gap-2">
     <div className="relative" ref={langRef}><button type="button" aria-label="Language" onClick={()=>{setLangOpen(v=>!v);setNoticeOpen(false);setProfileOpen(false)}} className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/5 p-1.5 hover:border-[var(--theme-accent)]/30"><img src={current.src} alt={current.name} className="h-6 w-8 rounded object-cover"/></button>{langOpen&&<div className="absolute right-0 top-12 z-[60] w-44 rounded-2xl border border-white/10 bg-[#0b0b10] p-2 shadow-2xl">{FLAGS.map(x=><button key={x.key} type="button" onClick={()=>{setLanguage(x.key);closeMenus()}} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-white/5 ${language===x.key?"bg-[var(--theme-accent-bg)] text-[var(--theme-accent)]":"text-zinc-300"}`}><img src={x.src} alt="" className="h-5 w-7 rounded object-cover"/><span>{x.name}</span></button>)}</div>}</div>
     {loading?<div className="h-10 w-28 animate-pulse rounded-xl border border-white/5 bg-white/[.03]"/>:user?<>
      <div className="relative" ref={noticeRef}><button type="button" aria-label="Notifications" onClick={()=>{setNoticeOpen(v=>!v);setLangOpen(false);setProfileOpen(false)}} className="relative grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/5 text-lg hover:border-[var(--theme-accent)]/40"><svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" strokeLinecap="round" strokeLinejoin="round"/></svg>{unread>0&&<span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[var(--theme-accent)] px-1 text-[10px] font-black text-black shadow-[0_0_14px_var(--theme-glow)]">{unread>9?"9+":unread}</span>}</button>{noticeOpen&&<div className="absolute right-0 top-12 z-[60] w-[360px] max-w-[calc(100vw-2rem)] rounded-2xl border border-white/10 bg-[#0b0b10] p-3 shadow-2xl"><div className="flex items-center justify-between px-2 py-1"><b>{ui.notifications}</b><button onClick={markAll} className="text-xs text-[var(--theme-accent)]">{ui.readAll}</button></div><div className="mt-2 max-h-96 space-y-2 overflow-auto">{notices.length?notices.map(n=><button key={n.id} onClick={()=>markNotice(n.id)} className={`block w-full rounded-xl border p-3 text-left transition hover:border-[var(--theme-accent)]/30 ${n.status==="UNREAD"?"border-[var(--theme-accent)]/20 bg-[var(--theme-accent-bg)]":"border-white/5 bg-white/[.02]"}`}><div className="flex items-start gap-2"><span className="mt-0.5 text-[var(--theme-accent)]">●</span><span><b className="text-sm">{noticeTitle(n)}</b><span className="mt-1 block text-xs leading-5 text-zinc-400">{noticeBody(n)}</span><span className="mt-1 block text-[10px] text-zinc-600">{new Date(n.createdAt).toLocaleString()}</span></span></div></button>):<div className="p-6 text-center text-sm text-zinc-500">{ui.empty}</div>}</div></div>}</div>
      <div className="relative" ref={profileRef}><button type="button" onClick={()=>{setProfileOpen(v=>!v);setLangOpen(false);setNoticeOpen(false)}} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm font-semibold transition hover:border-[var(--theme-accent)]/30"><img src={avatar||"/branding/duelplay-wolf-mark-safe.png"} alt="" className="h-8 w-8 rounded-lg object-cover"/><span className="hidden max-w-28 truncate sm:inline">{user.nickname}</span><span className="text-xs text-zinc-500">⌄</span></button>{profileOpen&&<div className="absolute right-0 top-12 z-[60] w-64 rounded-2xl border border-white/10 bg-[#0b0b10] p-2 shadow-2xl"><div className="border-b border-white/5 px-3 py-3"><div className="font-bold">{user.nickname}</div><div className="mt-1 text-xs text-zinc-500">Steam ID: {user.steamId||"—"}</div><div className="mt-2 text-lg font-black text-[var(--theme-accent)]">${Number(user.balance).toFixed(2)}</div></div><Link href="/profile" onClick={closeMenus} className="block rounded-xl px-3 py-2 text-sm hover:bg-white/5">{ui.profile}</Link><Link href="/wallet" onClick={closeMenus} className="block rounded-xl px-3 py-2 text-sm hover:bg-white/5">{ui.wallet}</Link><Link href="/inventory" onClick={closeMenus} className="block rounded-xl px-3 py-2 text-sm hover:bg-white/5">{ui.inventory}</Link><Link href="/profile#theme" onClick={closeMenus} className="block rounded-xl px-3 py-2 text-sm hover:bg-white/5">{ui.appearance}</Link>{user.role&&user.role!=="USER"&&<Link href="/admin" onClick={closeMenus} className="block rounded-xl px-3 py-2 text-sm text-[var(--theme-accent)] hover:bg-white/5">{ui.admin}</Link>}<button onClick={()=>{closeMenus();logout()}} className="mt-1 w-full rounded-xl border border-red-400/20 px-3 py-2 text-left text-sm text-red-300 hover:bg-red-500/10">{ui.logout}</button></div>}</div>
     </>:<Link href="/login" className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold hover:border-[var(--theme-accent)]/30 hover:text-[var(--theme-accent)]">{t.loginSteam}</Link>}
    </div>
   </div>
   {menuOpen&&<div className="border-t border-white/10 bg-[#050507] px-4 py-3 md:hidden"><nav className="flex flex-col gap-1">{links}</nav>{user&&<div className="mt-2 grid grid-cols-3 gap-2 border-t border-white/5 pt-3"><Link href="/create" className="rounded-xl bg-[var(--theme-accent)] px-3 py-2 text-center text-sm font-black text-black">{t.createMatch}</Link><Link href="/wallet" onClick={closeMenus} className="rounded-xl border border-white/10 px-3 py-2 text-center text-sm">{ui.wallet}</Link><Link href="/inventory" onClick={closeMenus} className="rounded-xl border border-white/10 px-3 py-2 text-center text-sm">{ui.inventory}</Link></div>}</div>}
  </header>
 </>;
}
