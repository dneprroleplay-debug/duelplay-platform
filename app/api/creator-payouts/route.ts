import {NextRequest,NextResponse} from 'next/server';import {prisma} from '@/lib/prisma';import {audit} from '@/lib/admin';import {requirePermission} from '@/lib/admin-rbac';
import {enforceRateLimit} from '@/lib/rate-limit';
function payoutAccessError(error:unknown):NextResponse|null{
  if(!(error instanceof Error))return null;
  if(error.message==='ADMIN_LOGIN_REQUIRED')return NextResponse.json({error:'Требуется вход администратора',errorCode:error.message},{status:401});
  if(error.message==='ADMIN_MFA_SETUP_REQUIRED')return NextResponse.json({error:'Требуется настроить MFA администратора',errorCode:error.message},{status:403});
  if(error.message==='ADMIN_MFA_REQUIRED')return NextResponse.json({error:'Требуется подтверждение MFA администратора',errorCode:error.message},{status:403});
  if(error.message==='FORBIDDEN')return NextResponse.json({error:'Недостаточно прав'},{status:403});
  if(error.message==='RATE_LIMITED')return NextResponse.json({error:'Слишком много запросов.'},{status:429});
  if(error.message==='PAYOUT_FINALIZED')return NextResponse.json({error:'Выплата уже завершена',errorCode:error.message},{status:409});
  if(error.message==='PAYOUT_NOT_APPROVED')return NextResponse.json({error:'Выплата должна быть одобрена до оплаты',errorCode:error.message},{status:409});
  if(error.message==='PAYOUT_INVALID_TRANSITION')return NextResponse.json({error:'Недопустимый переход статуса выплаты',errorCode:error.message},{status:409});
  return null;
}
export async function GET(){
  try{
    const access=await requirePermission("creator.payouts.manage"); const me=access.user;
    try{await prisma.$transaction(tx=>enforceRateLimit(tx,me.id,'CREATOR_PAYOUT_ADMIN_GET',60,10*60_000));}catch(error){if(error instanceof Error&&error.message==='RATE_LIMITED')return NextResponse.json({error:'Слишком много запросов.'},{status:429});throw error;}
    return NextResponse.json(await prisma.creatorPayout.findMany({orderBy:{createdAt:'desc'},take:200,include:{user:{select:{nickname:true}},creator:{include:{user:{select:{nickname:true}}}}}}));
  }catch(error){
    return payoutAccessError(error)??NextResponse.json({error:'Не удалось загрузить выплаты'},{status:500});
  }
}
export async function PATCH(r:NextRequest){
  try{
    const b=await r.json();const id=String(b.id||''),status=String(b.status||'');
    if(!['APPROVED','PAID','REJECTED'].includes(status))return NextResponse.json({error:'Invalid status'},{status:400});
    const requiredPermission=status==='PAID'?'creator.payouts.pay':'creator.payouts.manage';
    const access=await requirePermission(requiredPermission); const me=access.user;
    try{await prisma.$transaction(tx=>enforceRateLimit(tx,me.id,'CREATOR_PAYOUT_ADMIN_PATCH',30,10*60_000));}catch(error){if(error instanceof Error&&error.message==='RATE_LIMITED')return NextResponse.json({error:'Слишком много административных операций выплат.'},{status:429});throw error;}
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
  }catch(error){
    return payoutAccessError(error)??NextResponse.json({error:'Операция не выполнена'},{status:500});
  }
}
