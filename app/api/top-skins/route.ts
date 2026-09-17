import {NextResponse} from "next/server";
import {prisma} from "@/lib/prisma";
export async function GET(){const skins=await prisma.topSkin.findMany({where:{active:true},orderBy:[{sortOrder:"asc"},{createdAt:"desc"}],take:12,select:{id:true,name:true,imageData:true,createdAt:true}});return NextResponse.json({skins})}
