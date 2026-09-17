import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { grantDepositBonus } from "@/lib/promotions";
import { creditWallet, debitWallet } from "@/lib/wallet";
import { assertAccountCanWithdraw } from "@/lib/anti-fraud";

export async function GET(){
 const user=await getCurrentUser();
 if(!user)return NextResponse.json({error:"Не авторизован"},{status:401});
 const transactions=await prisma.transaction.findMany({where:{wallet:{userId:user.id}},orderBy:{createdAt:"desc"},take:100,select:{id:true,type:true,amount:true,description:true,status:true,createdAt:true}});
 return NextResponse.json({transactions:transactions.map(t=>({...t,amount:t.amount.toString()}))});
}

export async function POST(request:NextRequest){
 const user=await getCurrentUser();
 if(!user)return NextResponse.json({error:"Не авторизован"},{status:401});
 const body=await request.json().catch(()=>({}));
 const action=String(body.action||"");
 const amount=Number(body.amount);
 const idem=String(request.headers.get("idempotency-key")||body.idempotencyKey||randomUUID());
 if(!Number.isFinite(amount)||amount<=0)return NextResponse.json({error:"Некорректная сумма"},{status:400});
 if(action==="deposit"){
  const provider=String(body.provider||"STRIPE");
  if(!["STRIPE","PAYPAL","CRYPTO","STEAM_MARKET","SKRILL"].includes(provider))return NextResponse.json({error:"Неподдерживаемый провайдер"},{status:400});
  const providerTxId=`local-${idem}`;
  const existing=await prisma.deposit.findUnique({where:{providerTxId}});
  if(existing)return NextResponse.json({ok:true,idempotent:true,deposit:existing});
  const local=process.env.NODE_ENV!=="production" && process.env.DUELPLAY_LOCAL_TEST_MODE!=="false";
  if(local){
   const result=await prisma.$transaction(async tx=>{
    const wallet=await tx.wallet.findUniqueOrThrow({where:{userId:user.id}});

    const deposit=await tx.deposit.create({data:{walletId:wallet.id,provider:provider as never,providerTxId,amount,status:"COMPLETED",paymentDetails:{localTest:true}}});
    const credited=await creditWallet(tx,user.id,amount,`deposit:${idem}`,"DEPOSIT",`Local test deposit · ${provider}`,deposit.id);
    const after=Number(credited.transaction.balanceAfter);
    await grantDepositBonus(tx,user.id,deposit.id,amount,provider);
    await tx.notification.create({data:{userId:user.id,type:"DEPOSIT",title:"Deposit completed",body:`$${amount.toFixed(2)} added to your DuelPlay balance.`,payload:{depositId:deposit.id}}});
    return {deposit,balance:after};
   });
   return NextResponse.json({ok:true,localTest:true,...result},{status:201});
  }
  const deposit=await prisma.deposit.create({data:{walletId:(await prisma.wallet.findUniqueOrThrow({where:{userId:user.id}})).id,provider:provider as never,providerTxId,amount,status:"PENDING",paymentDetails:{idempotencyKey:idem}}});
  return NextResponse.json({ok:true,pending:true,deposit},{status:202});
 }
 if(action==="withdraw"){
  const destination=String(body.destination||"").trim();
  if(!destination)return NextResponse.json({error:"Укажите реквизиты"},{status:400});
  const existing=await prisma.withdrawal.findUnique({where:{idempotencyKey:idem}}); if(existing)return NextResponse.json({ok:true,idempotent:true,withdrawal:existing});
  let result;
  try { result=await prisma.$transaction(async tx=>{
   await assertAccountCanWithdraw(tx,user.id);
   const wallet=await tx.wallet.findUniqueOrThrow({where:{userId:user.id}});
   let withdrawal;
   try {
     withdrawal=await tx.withdrawal.create({data:{walletId:wallet.id,provider:String(body.provider||"STRIPE") as never,destination,amount,status:"PENDING",idempotencyKey:idem}});
   } catch(error) {
     if(error && typeof error === "object" && "code" in error && (error as {code?:string}).code === "P2002") throw new Error("DUPLICATE_WITHDRAWAL");
     throw error;
   }
   const debit=await debitWallet(tx,user.id,amount,`withdraw:${idem}`,"WITHDRAW","Withdrawal request",withdrawal.id);
   if(debit.idempotent) throw new Error("DUPLICATE_WITHDRAWAL");
   await tx.transaction.update({where:{id:debit.transaction.id},data:{status:"PENDING"}});
   await tx.wallet.update({where:{id:wallet.id},data:{lockedBalance:{increment:amount}}});
   const risk=amount>=1000?80:amount>=500?50:10;
   if(risk>=50) await tx.fraudCase.create({data:{userId:user.id,status:"DETECTED",riskScore:risk,reason:`Withdrawal risk threshold · $${amount.toFixed(2)}`,aiResult:{source:"withdrawal-rule",amount}}});
   await tx.notification.create({data:{userId:user.id,type:"WITHDRAWAL",title:"Withdrawal requested",body:`Withdrawal of $${amount.toFixed(2)} is under review.`,payload:{withdrawalId:withdrawal.id,riskFlag:risk>=50}}});
   return {withdrawal,balance:Number(debit.transaction.balanceAfter)};
  }); } catch(error) {
    if(error instanceof Error && error.message === "DUPLICATE_WITHDRAWAL") {
      const existing=await prisma.withdrawal.findUnique({where:{idempotencyKey:idem}});
      if(existing) return NextResponse.json({ok:true,idempotent:true,withdrawal:existing});
    }
    if(error instanceof Error && (error.message === "INSUFFICIENT" || error.message === "INSUFFICIENT_BALANCE")) return NextResponse.json({error:"Недостаточно средств"},{status:400});
    if(error instanceof Error && (error.message === "WITHDRAWALS_FROZEN" || error.message === "ACCOUNT_DEACTIVATED")) return NextResponse.json({error:"Вывод средств временно заморожен.",errorCode:error.message},{status:403});
    throw error;
  }
  return NextResponse.json({ok:true,...result},{status:201});
 }
 return NextResponse.json({error:"Unknown wallet action"},{status:400});
}
