import {NextResponse} from "next/server";
import {prisma} from "@/lib/prisma";

export async function GET(){
 const latest=await prisma.auditLog.findFirst({orderBy:[{createdAt:"desc"},{id:"desc"}],select:{id:true,createdAt:true}});
 return NextResponse.json({version:latest?`${latest.createdAt.toISOString()}-${latest.id}`:"0"},{headers:{"Cache-Control":"no-store, max-age=0"}});
}
