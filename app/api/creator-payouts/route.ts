import {NextRequest,NextResponse} from 'next/server';import {prisma} from '@/lib/prisma';import {requireAdmin,adminLevel,audit} from '@/lib/admin';
import {enforceRateLimit} from '@/lib/rate-limit';
export async function GET(){const me=await requireAdmin(3);try{await prisma.$transaction(tx=>enforceRateLimit(tx,me.id,'CREATOR_PAYOUT_ADMIN_GET',60,10*60_000));}catch(error){if(error instanceof Error&&error.message==='RATE_LIMITED')return NextResponse.json({error:'Слишком много запросов.'},{status:429});throw error;}return NextResponse.json(await prisma.creatorPayout.findMany({orderBy:{createdAt:'desc'},take:200,include:{user:{select:{nickname:true}},creator:{include:{user:{select:{nickname:true}}}}}}))}
export async function PATCH(r:NextRequest){
  const me=await requireAdmin(3);
  try{await prisma.$transaction(tx=>enforceRateLimit(tx,me.id,'CREATOR_PAYOUT_ADMIN_PATCH',30,10*60_000));}catch(error){if(error instanceof Error&&error.message==='RATE_LIMITED')return NextResponse.json({error:'Слишком много административных операций выплат.'},{status:429});throw error;}const b=await r.json();const id=String(b.id||''),status=String(b.status||'');
  if(!['APPROVED','PAID','REJECTED'].includes(status))return NextResponse.json({error:'Invalid status'},{status:400});
  if(status==='PAID'&&adminLevel(me.role)<5)return NextResponse.json({error:'SUPERADMIN required'},{status:403});
  const row=await prisma.$transaction(async tx=>{
    const current=await tx.creatorPayout.findUnique({where:{id}});if(!current)return null;
    if(current.status===status)return current;
    if(current.status==='PAID')throw new Error('PAYOUT_FINALIZED');
    if(status==='PAID'&&current.status!=='APPROVED')throw new Error('PAYOUT_NOT_APPROVED');
    if(status==='APPROVED'&&current.status!=='PENDING')throw new Error('PAYOUT_INVALID_TRANSITION');
    return tx.creatorPayout.update({where:{id},data:{status:status as never,approvedAt:status==='APPROVED'?new Date():current.approvedAt,paidAt:status==='PAID'?new Date():current.paidAt,rejectionReason:status==='REJECTED'?String(b.reason||'Rejected'):null}});
  });
  if(!row)return NextResponse.json({error:'Payout not found'},{status:404});
  await audit(me.id,'CREATOR_PAYOUT_STATUS','CREATOR_PAYOUT',id,{status,result:'OK'});return NextResponse.json(row);
}
