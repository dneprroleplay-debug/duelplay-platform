"use client";
import Live from "@/components/Live/Live";
import MatchmakingPanel from "@/components/Matchmaking/MatchmakingPanel";

export default function MatchesPage(){
  return <><main className="min-h-screen pt-16"><MatchmakingPanel/><Live mode="waiting" showFilters/></main></>;
}
