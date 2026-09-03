"use client";
import {createContext,useContext,useEffect,useMemo,useState} from "react";

export type HeaderUser={
  id:string; nickname:string; balance:string; role?:string;
  avatarUrl?:string|null; steamId?:string|null; steamAvatarUrl?:string|null;
};
type AuthContextValue={user:HeaderUser|null; loading:boolean; refresh:()=>Promise<void>; logout:()=>Promise<void>};
const AuthContext=createContext<AuthContextValue|null>(null);

export function AuthProvider({children}:{children:React.ReactNode}){
  const [user,setUser]=useState<HeaderUser|null>(null);
  const [loading,setLoading]=useState(true);
  const refresh=async()=>{
    try{
      const r=await fetch("/api/auth/me",{cache:"no-store"});
      const d=await r.json().catch(()=>({}));
      setUser(d.user??null);
    }catch{setUser(null)}
    finally{setLoading(false)}
  };
  useEffect(()=>{
    refresh();
    const onAuth=()=>{void refresh()};
    window.addEventListener("duelplay:auth-changed",onAuth);
    return()=>window.removeEventListener("duelplay:auth-changed",onAuth);
  },[]);
  const logout=async()=>{
    try{await fetch("/api/auth/logout",{method:"POST"})}finally{
      setUser(null);
      window.dispatchEvent(new Event("duelplay:auth-changed"));
      window.location.href="/?intro=1";
    }
  };
  const value=useMemo(()=>({user,loading,refresh,logout}),[user,loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth(){
  const value=useContext(AuthContext);
  if(!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
