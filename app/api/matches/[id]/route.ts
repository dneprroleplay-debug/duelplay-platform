import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildLiveMatchState } from "@/lib/live-match";
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){const{id}=await params;const match=await prisma.match.findUnique({where:{id},include:{game:true,gameServer:{select:{lastHeartbeat:true,status:true,host:true,port:true}},playerOne:{select:{id:true,nickname:true,avatarUrl:true}},playerTwo:{select:{id:true,nickname:true,avatarUrl:true}},winner:{select:{id:true,nickname:true}},loser:{select:{id:true,nickname:true}}}});if(!match)return NextResponse.json({error:"Матч не найден"},{status:404});const rawConfig = match.serverConfig;
  const liveState = ["READY", "STARTING", "LIVE"].includes(match.status)
    ? buildLiveMatchState(rawConfig, Date.now(), match.gameServer?.lastHeartbeat)
    : null;
  const safeConfig = rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig)
    ? Object.fromEntries(Object.entries(rawConfig as Record<string, unknown>).filter(([key]) => !["connectedSteamIds", "playerOneSteamId", "playerTwoSteamId", "processId"].includes(key)))
    : rawConfig;
  return NextResponse.json({match: { ...match, serverConfig: safeConfig, liveState }})}
