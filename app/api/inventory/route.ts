import {NextResponse} from "next/server";
import {prisma} from "@/lib/prisma";
import {getCurrentUser} from "@/lib/current-user";
export async function GET(){
 const user=await getCurrentUser(); if(!user)return NextResponse.json({error:"Войдите в аккаунт"},{status:401});
 const items=await prisma.inventoryItem.findMany({where:{userId:user.id},orderBy:{createdAt:"desc"},take:100});
 return NextResponse.json(items.map(x=>({...x,value:Number(x.value)})));
}
