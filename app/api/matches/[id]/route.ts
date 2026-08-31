import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){const{id}=await params;const match=await prisma.match.findUnique({where:{id},include:{game:true,playerOne:{select:{id:true,nickname:true,avatarUrl:true}},playerTwo:{select:{id:true,nickname:true,avatarUrl:true}},winner:{select:{id:true,nickname:true}},loser:{select:{id:true,nickname:true}}}});if(!match)return NextResponse.json({error:"Матч не найден"},{status:404});return NextResponse.json({match})}
