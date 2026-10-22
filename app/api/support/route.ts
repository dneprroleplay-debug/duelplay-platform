import {NextRequest,NextResponse} from "next/server";
import {prisma} from "@/lib/prisma";
import {getCurrentUser} from "@/lib/current-user";
import {isStaffRole} from "@/lib/role-policy";


async function hydrateTicketSenders<T extends {messages?: Array<{senderId:string}>}>(ticket: T){
 const ids=[...new Set((ticket.messages||[]).map(m=>m.senderId))];
 if(!ids.length)return ticket;
 const users=await prisma.user.findMany({where:{id:{in:ids}},select:{id:true,nickname:true,role:true}});
 const byId=new Map(users.map(u=>[u.id,u]));
 return {...ticket,messages:(ticket.messages||[]).map(m=>({...m,sender:byId.get(m.senderId)||null}))} as T & {messages:Array<{senderId:string;sender:{id:string;nickname:string;role:string}|null}>};
}

async function hydrateTickets<T extends {messages?: Array<{senderId:string}>}>(tickets:T[]){
 const ids=[...new Set(tickets.flatMap(t=>(t.messages||[]).map(m=>m.senderId)))];
 if(!ids.length)return tickets;
 const users=await prisma.user.findMany({where:{id:{in:ids}},select:{id:true,nickname:true,role:true}});
 const byId=new Map(users.map(u=>[u.id,u]));
 return tickets.map(t=>({...t,messages:(t.messages||[]).map(m=>({...m,sender:byId.get(m.senderId)||null}))})) as Array<T & {messages:Array<{senderId:string;sender:{id:string;nickname:string;role:string}|null}>}>;
}

export async function GET(){
 const user=await getCurrentUser(); if(!user)return NextResponse.json({error:"Войдите в аккаунт"},{status:401});
 const tickets=await prisma.supportTicket.findMany({where:{userId:user.id},orderBy:{updatedAt:"desc"},include:{messages:{orderBy:{createdAt:"asc"}}}});
 return NextResponse.json({tickets:await hydrateTickets(tickets)});
}
export async function PATCH(req:NextRequest){
 const user=await getCurrentUser(); if(!user)return NextResponse.json({error:"Войдите в аккаунт"},{status:401});
 const body=await req.json().catch(()=>({}));
 const ticketId=String(body.ticketId||"").trim();
 if(!ticketId)return NextResponse.json({error:"Обращение не найдено"},{status:400});
 const notifications=await prisma.notification.findMany({where:{userId:user.id,status:"UNREAD",title:{in:["Ответ поддержки","Обращение закрыто"]}},select:{id:true,payload:true}});
 for(const n of notifications){
   const payload=n.payload as {ticketId?:string}|null;
   if(payload?.ticketId===ticketId) await prisma.notification.update({where:{id:n.id},data:{status:"READ",readAt:new Date()}});
 }
 return NextResponse.json({ok:true});
}

export async function POST(req:NextRequest){
 const user=await getCurrentUser(); if(!user)return NextResponse.json({error:"Войдите в аккаунт"},{status:401});
 const body=await req.json(); const ticketId=String(body.ticketId||"").trim(); const message=String(body.message||"").trim().slice(0,3000);
 if(!message)return NextResponse.json({error:"Введите сообщение"},{status:400});
  if(ticketId){
    const isAdmin=isStaffRole(user.role);
    try {
      const updated=await prisma.$transaction(async tx=>{
        const ticket=await tx.supportTicket.findUnique({where:{id:ticketId},include:{messages:{orderBy:{createdAt:"asc"}}}});
        if(!ticket)throw new Error("NOT_FOUND");
        if(ticket.userId!==user.id&&!isAdmin)throw new Error("FORBIDDEN");
        if(ticket.status==="CLOSED")throw new Error("CLOSED");
        const senderIsAdmin=isAdmin&&ticket.userId!==user.id;
        await tx.ticketMessage.create({data:{ticketId,senderId:user.id,message}});
        await tx.supportTicket.update({where:{id:ticketId},data:{status:senderIsAdmin?"WAITING_ON_USER":"IN_PROGRESS",assignedToId:senderIsAdmin?user.id:ticket.assignedToId}});
        const fresh=await tx.supportTicket.findUnique({where:{id:ticketId},include:{messages:{orderBy:{createdAt:"asc"}}}});
        if(senderIsAdmin)await tx.notification.create({data:{userId:ticket.userId,type:"SYSTEM",status:"UNREAD",title:"Ответ поддержки",body:message,payload:{ticketId,kind:"SUPPORT_REPLY",subject:ticket.subject}}});
        return fresh!;
      });
      return NextResponse.json({ok:true,ticket:await hydrateTicketSenders(updated)});
    } catch (e) {
      const msg=e instanceof Error?e.message:"";
      if(msg==="NOT_FOUND")return NextResponse.json({error:"Обращение не найдено"},{status:404});
      if(msg==="FORBIDDEN")return NextResponse.json({error:"Нет доступа"},{status:403});
      if(msg==="CLOSED")return NextResponse.json({error:"Обращение закрыто"},{status:409});
      throw e;
    }
  }
 const subject=String(body.subject||"").trim().slice(0,160),category=String(body.category||"GENERAL").slice(0,32);
 if(!subject)return NextResponse.json({error:"Укажите тему обращения"},{status:400});
 const ticket=await prisma.supportTicket.create({data:{userId:user.id,subject,category,priority:category==="SECURITY"?"HIGH":"MEDIUM",messages:{create:{senderId:user.id,message}}},include:{messages:true}});
 return NextResponse.json({ok:true,ticket:await hydrateTicketSenders(ticket)},{status:201});
}
