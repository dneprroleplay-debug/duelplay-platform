import { Prisma } from '@prisma/client';
import { awardDuelPassXp } from '@/lib/duel-pass';
import { boostedXpAmount } from '@/lib/xp-booster';
import { refreshEventMissionsForUser } from '@/lib/event-pass';

export function levelFromXp(xp:number){
  const safe=Math.max(0,Math.floor(xp));
  return Math.max(1,Math.min(100,Math.floor(Math.sqrt(safe/100))+1));
}

export function eloDelta(winnerRating:number, loserRating:number, k=32){
  const expectedWinner=1/(1+Math.pow(10,(loserRating-winnerRating)/400));
  const delta=Math.max(1,Math.round(k*(1-expectedWinner)));
  return {winner:delta,loser:-delta};
}

export async function awardXp(tx:Prisma.TransactionClient,userId:string,amount:number){
  const baseAmount=Math.max(0,Math.floor(Number(amount)||0));
  // Serialize XP writes per user so concurrent match/reward transactions cannot lose XP.
  const locked=await tx.$queryRaw<Array<{xp:number;level:number}>>`SELECT xp, level FROM "User" WHERE id = ${userId} FOR UPDATE`;
  const user=locked[0];
  if(!user)return null;
  const now=new Date();
  await tx.xPBooster.updateMany({where:{userId,active:true,endsAt:{lte:now}},data:{active:false}});
  const booster=await tx.xPBooster.findFirst({where:{userId,active:true,startsAt:{lte:now},endsAt:{gt:now}},orderBy:[{multiplier:'desc'},{endsAt:'desc'}]});
  const gain=booster ? boostedXpAmount(baseAmount,Number(booster.multiplier)) : baseAmount;
  const xp=Math.max(0,Math.floor(Number(user.xp)+gain));
  const level=levelFromXp(xp);
  const updated=await tx.user.update({where:{id:userId},data:{xp,level}});
  await awardDuelPassXp(tx,userId,gain);
  return updated;
}

export async function updateMatchProgress(tx:Prisma.TransactionClient,userId:string,winner:boolean){
  // Result transactions already lock the match. This additional transaction-scoped
  // advisory lock serializes progression writes so two result paths cannot race a
  // player's streak/win/loss counters.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('duelplay:progression'))`;
  const stats=await tx.playerStats.upsert({where:{userId},update:{totalDuels:{increment:1},wins:winner?{increment:1}:undefined,losses:winner?undefined:{increment:1},winStreak:winner?{increment:1}:0},create:{userId,totalDuels:1,wins:winner?1:0,losses:winner?0:1,winStreak:winner?1:0,bestStreak:winner?1:0,rating:1000}});
  if(winner && stats.winStreak>stats.bestStreak) await tx.playerStats.update({where:{userId},data:{bestStreak:stats.winStreak}});
  const finalStats = winner && stats.winStreak > stats.bestStreak ? {...stats,bestStreak:stats.winStreak} : stats;
  const activeEvents=await tx.event.findMany({where:{status:{in:["SCHEDULED","ACTIVE"]},startsAt:{lte:new Date()},endsAt:{gt:new Date()},eventPass:true},select:{id:true}});
  for(const event of activeEvents) await refreshEventMissionsForUser(tx,userId,event.id);
  return finalStats;
}

export async function updateRatingAfterDuel(tx:Prisma.TransactionClient,winnerId:string,loserId:string){
  const [winner,loser]=await Promise.all([
    tx.playerStats.upsert({where:{userId:winnerId},update:{},create:{userId:winnerId,rating:1000}}),
    tx.playerStats.upsert({where:{userId:loserId},update:{},create:{userId:loserId,rating:1000}}),
  ]);
  const delta=eloDelta(winner.rating,loser.rating);
  const now=new Date().toISOString();
  const winnerHistory=Array.isArray(winner.ratingHistory)?winner.ratingHistory:[];
  const loserHistory=Array.isArray(loser.ratingHistory)?loser.ratingHistory:[];
  await tx.playerStats.update({where:{userId:winnerId},data:{rating:{increment:delta.winner},ratingHistory:[...winnerHistory,{at:now,rating:winner.rating+delta.winner,delta:delta.winner,result:'WIN'}]}});
  await tx.playerStats.update({where:{userId:loserId},data:{rating:{increment:delta.loser},ratingHistory:[...loserHistory,{at:now,rating:Math.max(0,loser.rating+delta.loser),delta:delta.loser,result:'LOSS'}]}});
  return delta;
}

export async function recordMatchStats(tx:Prisma.TransactionClient,matchId:string,userId:string,input:{kills?:unknown;assists?:unknown;deaths?:unknown;headshots?:unknown;damage?:unknown;score?:unknown;weapon?:unknown;mapName?:unknown}){
  const n=(v:unknown)=>Math.max(0,Math.floor(Number(v)||0));
  return tx.matchPlayerStat.upsert({where:{matchId_userId:{matchId,userId}},update:{kills:n(input.kills),assists:n(input.assists),deaths:n(input.deaths),headshots:n(input.headshots),damage:n(input.damage),score:n(input.score),weapon:typeof input.weapon==='string'?input.weapon.slice(0,80):undefined,mapName:typeof input.mapName==='string'?input.mapName.slice(0,80):undefined},create:{matchId,userId,kills:n(input.kills),assists:n(input.assists),deaths:n(input.deaths),headshots:n(input.headshots),damage:n(input.damage),score:n(input.score),weapon:typeof input.weapon==='string'?input.weapon.slice(0,80):undefined,mapName:typeof input.mapName==='string'?input.mapName.slice(0,80):undefined}});
}
