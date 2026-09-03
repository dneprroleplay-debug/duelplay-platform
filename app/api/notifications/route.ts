import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ notifications: [], unread: 0 });
  const notifications = await prisma.notification.findMany({
    where: { userId: user.id, status: { not: "ARCHIVED" } },
    orderBy: { createdAt: "desc" }, take: 20,
    select: { id:true,type:true,status:true,title:true,body:true,payload:true,createdAt:true,readAt:true }
  });
  return NextResponse.json({ notifications, unread: notifications.filter(n=>n.status==="UNREAD").length });
}

export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error:"Не авторизован" }, { status:401 });
  const body = await request.json().catch(()=>({}));
  if (body.all) {
    await prisma.notification.updateMany({ where:{userId:user.id,status:"UNREAD"}, data:{status:"READ",readAt:new Date()} });
  } else if (body.id) {
    await prisma.notification.updateMany({ where:{id:String(body.id),userId:user.id}, data:{status:"READ",readAt:new Date()} });
  }
  return NextResponse.json({ok:true});
}
