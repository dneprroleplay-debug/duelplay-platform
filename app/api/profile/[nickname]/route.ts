import { leagueFromRating } from "@/lib/leagues";
import {NextResponse} from "next/server";
import {prisma} from "@/lib/prisma";
import {getCurrentUser} from "@/lib/current-user";
import { calculateProfileCompletion } from "@/lib/profile-completion";
import { cosmeticFrameImageUrl } from "@/lib/cosmetic-frame-image";
export async function GET(_:Request,{params}:{params:Promise<{nickname:string}>}){
 const viewer=await getCurrentUser();
 const {nickname}=await params;
  const u=await prisma.user.findUnique({where:{nickname},select:{id:true,nickname:true,avatarUrl:true,steamAvatarUrl:true,steamId:true,email:true,emailVerifiedAt:true,equippedFrameItem:{select:{id:true,slug:true,name:true,imageUrl:true}},level:true,xp:true,reputation:true,createdAt:true,profileVisibility:true,showStatsPublic:true,allowChallenges:true,allowMessages:true,achievements:{include:{achievement:true}},matchesAsPlayerOne:{select:{id:true,status:true,economyMode:true,mapName:true,winnerId:true,createdAt:true}},matchesAsPlayerTwo:{select:{id:true,status:true,economyMode:true,mapName:true,winnerId:true,createdAt:true}}}});
 if(!u)return NextResponse.json({error:"Profile not found"},{status:404});
 const me=viewer;
 // Anonymous visitors (me === null) are allowed: PUBLIC profiles are world-readable. They are never treated
 // as the owner, a friend or a rival, so relation/relationIncoming stay empty for them.
 const isMe=Boolean(me&&me.id===u.id);
 let relation:null|{status:string;senderId:string;receiverId:string}=null; if(me&&!isMe){relation=await prisma.friend.findFirst({where:{OR:[{senderId:me.id,receiverId:u.id},{senderId:u.id,receiverId:me.id}]},select:{status:true,senderId:true,receiverId:true}})}
 const myRival=me&&!isMe?await prisma.rival.findUnique({where:{ownerId_targetId:{ownerId:me.id,targetId:u.id}},select:{status:true}}):null;
 const visibleToViewer=u.profileVisibility==="PUBLIC" || isMe || (u.profileVisibility==="FRIENDS" && relation?.status==="ACCEPTED");
 const relationIncoming=Boolean(me&&!isMe&&relation?.status==="PENDING"&&relation.senderId===u.id&&relation.receiverId===me.id);
 // Access control runs BEFORE any statistics query: PRIVATE profiles and FRIENDS-only profiles without an
 // accepted friendship receive identity only and never touch statistics data at all. The owner is always
 // allowed through and always sees their own real statistics.
 if(!visibleToViewer) return NextResponse.json({restricted:true,reason:u.profileVisibility,profile:{id:u.id,nickname:u.nickname,avatarUrl:u.avatarUrl,steamAvatarUrl:u.steamAvatarUrl,profileVisibility:u.profileVisibility,isMe:false}});
 // showStatsPublic only hides statistics from strangers; the owner always sees real values.
 const statsVisible=isMe||u.showStatsPublic;
 const [stats,matchStats,clanMemberships,friendsSent,friendsReceived,rivals,rivalOf,collections]=await Promise.all([
  prisma.playerStats.findUnique({where:{userId:u.id}}),
   prisma.matchPlayerStat.findMany({where:{userId:u.id,match:{economyMode:"REAL"}},orderBy:{createdAt:"desc"},take:30,select:{kills:true,deaths:true,headshots:true,damage:true,score:true,weapon:true,mapName:true,createdAt:true}}),
  prisma.clanMember.findMany({where:{userId:u.id},include:{clan:{select:{id:true,name:true,tag:true,logoUrl:true,rating:true,wins:true,losses:true}}}}),
  prisma.friend.findMany({where:{senderId:u.id,status:"ACCEPTED"},include:{receiver:{select:{id:true,nickname:true,avatarUrl:true,steamAvatarUrl:true}}},take:20}),
  prisma.friend.findMany({where:{receiverId:u.id,status:"ACCEPTED"},include:{sender:{select:{id:true,nickname:true,avatarUrl:true,steamAvatarUrl:true}}},take:20}),
  prisma.rival.findMany({where:{ownerId:u.id,status:"ACTIVE"},include:{target:{select:{id:true,nickname:true,avatarUrl:true}}},take:20}),
  prisma.rival.findMany({where:{targetId:u.id,status:"ACTIVE"},include:{owner:{select:{id:true,nickname:true,avatarUrl:true}}},take:20}),
  prisma.collectionClaim.findMany({where:{userId:u.id},orderBy:{claimedAt:"desc"},take:30,select:{claimedAt:true,collection:{select:{id:true,name:true}}}})
 ]);
 const allMatches=[...u.matchesAsPlayerOne,...u.matchesAsPlayerTwo].sort((a,b)=>+new Date(b.createdAt)-+new Date(a.createdAt));
 const matches=allMatches.slice(0,5);
  const decisiveFinishedMatches=allMatches.filter(x=>x.economyMode==="REAL"&&x.status==="FINISHED" && Boolean(x.winnerId));
 const derivedWins=decisiveFinishedMatches.filter(x=>x.winnerId===u.id).length;
 const derivedLosses=decisiveFinishedMatches.filter(x=>x.winnerId!==u.id).length;
  const total=derivedWins + derivedLosses; const kills=stats?.kills??matchStats.reduce((n,x)=>n+x.kills,0); const deaths=stats?.deaths??matchStats.reduce((n,x)=>n+x.deaths,0); const hs=stats?.headshots??matchStats.reduce((n,x)=>n+x.headshots,0);
  const rawRating=stats?.rating??0; const rating=statsVisible?rawRating:null; const league=statsVisible?leagueFromRating(rawRating):null; const finishedMatchStats=matchStats.filter(x=>Number(x.kills)>=0&&Number(x.deaths)>=0); const avgKills=finishedMatchStats.length?finishedMatchStats.reduce((n,x)=>n+x.kills,0)/finishedMatchStats.length:0; const avgDeaths=finishedMatchStats.length?finishedMatchStats.reduce((n,x)=>n+x.deaths,0)/finishedMatchStats.length:0; const avgDamage=finishedMatchStats.length?finishedMatchStats.reduce((n,x)=>n+x.damage,0)/finishedMatchStats.length:0; const avgScore=finishedMatchStats.length?finishedMatchStats.reduce((n,x)=>n+x.score,0)/finishedMatchStats.length:0; const recentForm=matches.filter(x=>x.economyMode==="REAL"&&x.status==="FINISHED").slice(0,5).map(x=>x.winnerId===u.id?"W":x.winnerId?"L":"D"); const acceptedFriendsCount=friendsSent.length+friendsReceived.length; const finishedMatchCount=decisiveFinishedMatches.length; const profileCompletion=calculateProfileCompletion({hasCustomAvatar:Boolean(u.avatarUrl),acceptedFriends:acceptedFriendsCount,finishedMatches:finishedMatchCount,achievements:u.achievements.length,hasBothBindings:Boolean(u.steamId&&u.email&&u.emailVerifiedAt)}).percent;
 const leaderboard=statsVisible?await prisma.playerStats.findMany({orderBy:{rating:"desc"},select:{userId:true}}):[]; const leaguePosition=Math.max(0,leaderboard.findIndex(x=>x.userId===u.id)+1);
 return NextResponse.json({profile:{id:u.id,nickname:u.nickname,avatarUrl:u.avatarUrl,steamAvatarUrl:u.steamAvatarUrl,equippedFrame:u.equippedFrameItem ? {...u.equippedFrameItem,imageUrl:cosmeticFrameImageUrl(u.equippedFrameItem.slug,u.equippedFrameItem.imageUrl)} : null,level:statsVisible?u.level:null,xp:statsVisible?u.xp:null,reputation:statsVisible?u.reputation:null,profileVisibility:u.profileVisibility,showStatsPublic:u.showStatsPublic,allowChallenges:u.allowChallenges,allowMessages:u.allowMessages,wins:statsVisible?derivedWins:null,losses:statsVisible?derivedLosses:null,winRate:statsVisible?(total?(derivedWins/total*100):0):null,totalDuels:statsVisible?total:null,statsVisible,restricted:false,relationIncoming,winStreak:statsVisible?(stats?.winStreak??0):null,bestStreak:statsVisible?(stats?.bestStreak??0):null,rating,league,leaguePosition:statsVisible?leaguePosition:null,kills:statsVisible?kills:null,deaths:statsVisible?deaths:null,kd:statsVisible?(deaths?kills/deaths:kills):null,headshots:statsVisible?hs:null,hsRate:statsVisible?(kills?hs/kills*100:0):null,damage:statsVisible?(stats?.damage??matchStats.reduce((n,x)=>n+x.damage,0)):null,avgKills:statsVisible?avgKills:null,avgDeaths:statsVisible?avgDeaths:null,avgDamage:statsVisible?avgDamage:null,avgScore:statsVisible?avgScore:null,recentForm:statsVisible?recentForm:[],profileCompletion,ratingHistory:statsVisible?(stats?.ratingHistory??[]):[],achievements:u.achievements.map(x=>x.achievement),recentMatches:statsVisible?matches:[],joinedAt:u.createdAt,collections:collections.map(x=>({id:x.collection.id,name:x.collection.name,claimedAt:x.claimedAt})),clans:clanMemberships.map(x=>({role:x.role,...x.clan})),friends:[...friendsSent.map(x=>x.receiver),...friendsReceived.map(x=>x.sender)],rivals:[...rivals.map(x=>x.target),...rivalOf.map(x=>x.owner)],weaponStats:statsVisible?matchStats.reduce((a: Record<string, number>,x)=>{const k=x.weapon||"Other";a[k]=(a[k]||0)+1;return a},{}):{},mapStats:statsVisible?matchStats.reduce((a: Record<string, number>,x)=>{const k=x.mapName||"Unknown";a[k]=(a[k]||0)+1;return a},{}):{},relation:relation?.status??null,myRival:myRival?.status??null,isMe}})
}
