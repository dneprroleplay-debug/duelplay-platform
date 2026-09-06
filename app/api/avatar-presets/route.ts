import {NextResponse} from "next/server";
import {prisma} from "@/lib/prisma";
export async function GET(){const presets=await prisma.avatarPreset.findMany({where:{active:true},orderBy:[{sortOrder:"asc"},{createdAt:"desc"}],take:40,select:{id:true,name:true,imageData:true}});return NextResponse.json({presets})}
