import { Prisma, TransactionType } from "@prisma/client";

type Tx = Prisma.TransactionClient;
type MoneyInput = number | string | Prisma.Decimal;
type WalletDebitType = "MATCH_BET" | "TOURNAMENT_ENTRY" | "CASE_OPEN" | "BONUS" | "WITHDRAW" | "COMMISSION" | "COSMETIC_PURCHASE" | "PRIME_PURCHASE" | "DUELPASS_PURCHASE" | "EVENTPASS_PURCHASE" | "XP_BOOSTER_PURCHASE" | "TOURNAMENT_PRIZE" | "REFERRAL_RACE_PRIZE" | "INVENTORY_SALE";
type WalletCreditType = "MATCH_WIN" | "REFUND" | "BONUS" | "REFERRAL" | "DEPOSIT" | "TOURNAMENT_PRIZE" | "REFERRAL_RACE_PRIZE" | "INVENTORY_SALE";
type HoldType = "MATCH_STAKE" | "WITHDRAWAL";
type HoldFinalStatus = "RELEASED" | "CONSUMED";

function money(value: MoneyInput) {
  const decimal = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(String(value));
  if (!decimal.isFinite() || decimal.lte(0)) throw new Error("INVALID_AMOUNT");
  return decimal.toDecimalPlaces(4);
}
function referenceTypeFor(type: string) {
  if (type.includes("WITHDRAW")) return "WITHDRAWAL";
  if (type.includes("MATCH") || type.includes("REFUND")) return "MATCH";
  if (type.includes("TOURNAMENT")) return "TOURNAMENT";
  if (type.includes("DEPOSIT")) return "DEPOSIT";
  return type;
}
async function lockedWallet(tx: Tx, userId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string; balance: Prisma.Decimal; lockedBalance: Prisma.Decimal }>>`SELECT id,balance,"lockedBalance" FROM "Wallet" WHERE "userId"=${userId}::uuid FOR UPDATE`;
  if (!rows[0]) throw new Error("WALLET");
  return rows[0];
}
async function appendTransaction(tx: Tx, input: {walletId:string;type:TransactionType;amount:Prisma.Decimal;balanceBefore:Prisma.Decimal;balanceAfter:Prisma.Decimal;lockedBalanceBefore:Prisma.Decimal;lockedBalanceAfter:Prisma.Decimal;idempotencyKey?:string;referenceId?:string;description?:string;metadata?:Prisma.InputJsonValue}) {
  return tx.transaction.create({data:{walletId:input.walletId,type:input.type,status:"COMPLETED",amount:input.amount,balanceBefore:input.balanceBefore,balanceAfter:input.balanceAfter,lockedBalanceBefore:input.lockedBalanceBefore,lockedBalanceAfter:input.lockedBalanceAfter,referenceType:referenceTypeFor(input.type),referenceId:input.referenceId,idempotencyKey:input.idempotencyKey,description:input.description,metadata:input.metadata}});
}
export async function debitWallet(tx:Tx,userId:string,amount:MoneyInput,idempotencyKey:string,type:WalletDebitType="BONUS",description?:string,referenceId?:string){
  if(!idempotencyKey)throw new Error("IDEMPOTENCY_REQUIRED"); const value=money(amount);
  const existing=await tx.transaction.findUnique({where:{idempotencyKey},include:{wallet:{select:{userId:true}}}}); if(existing){if(existing.wallet.userId!==userId)throw new Error("IDEMPOTENCY_CONFLICT");return{idempotent:true,transaction:existing};}
  const wallet=await lockedWallet(tx,userId); const before=wallet.balance; if(before.lt(value))throw new Error("INSUFFICIENT_BALANCE"); const after=before.minus(value).toDecimalPlaces(4);
  await tx.wallet.update({where:{id:wallet.id},data:{balance:after}});
  const transaction=await appendTransaction(tx,{walletId:wallet.id,type,amount:value.negated(),balanceBefore:before,balanceAfter:after,lockedBalanceBefore:wallet.lockedBalance,lockedBalanceAfter:wallet.lockedBalance,idempotencyKey,referenceId,description});
  return{idempotent:false,transaction};
}
export async function creditWallet(tx:Tx,userId:string,amount:MoneyInput,idempotencyKey:string,type:WalletCreditType="BONUS",description?:string,referenceId?:string){
  if(!idempotencyKey)throw new Error("IDEMPOTENCY_REQUIRED"); const value=money(amount);
  const existing=await tx.transaction.findUnique({where:{idempotencyKey},include:{wallet:{select:{userId:true}}}}); if(existing){if(existing.wallet.userId!==userId)throw new Error("IDEMPOTENCY_CONFLICT");return{idempotent:true,transaction:existing};}
  const wallet=await lockedWallet(tx,userId); const before=wallet.balance; const after=before.plus(value).toDecimalPlaces(4);
  await tx.wallet.update({where:{id:wallet.id},data:{balance:after}});
  const transaction=await appendTransaction(tx,{walletId:wallet.id,type,amount:value,balanceBefore:before,balanceAfter:after,lockedBalanceBefore:wallet.lockedBalance,lockedBalanceAfter:wallet.lockedBalance,idempotencyKey,referenceId,description});
  return{idempotent:false,transaction};
}
export async function lockWallet(tx:Tx,userId:string,amount:MoneyInput,idempotencyKey:string,type:HoldType,referenceId?:string,description?:string){
  if(!idempotencyKey)throw new Error("IDEMPOTENCY_REQUIRED"); const value=money(amount);
  const existing=await tx.transaction.findUnique({where:{idempotencyKey},include:{wallet:{select:{userId:true}}}}); if(existing){if(existing.wallet.userId!==userId)throw new Error("IDEMPOTENCY_CONFLICT");return{idempotent:true,transaction:existing,hold:await tx.walletHold.findUnique({where:{idempotencyKey}})};}
  const wallet=await lockedWallet(tx,userId); const lockedBefore=wallet.lockedBalance; const lockedAfter=lockedBefore.plus(value).toDecimalPlaces(4);
  await tx.wallet.update({where:{id:wallet.id},data:{lockedBalance:lockedAfter}});
  const hold=await tx.walletHold.create({data:{walletId:wallet.id,type,status:"ACTIVE",amount:value,currency:"USD",referenceType:referenceTypeFor(type),referenceId,idempotencyKey,metadata:description?{description}:undefined}});
  const transaction=await appendTransaction(tx,{walletId:wallet.id,type:type==="WITHDRAWAL"?"WITHDRAWAL_RESERVE":"MATCH_STAKE_LOCK",amount:new Prisma.Decimal(0),balanceBefore:wallet.balance,balanceAfter:wallet.balance,lockedBalanceBefore:lockedBefore,lockedBalanceAfter:lockedAfter,idempotencyKey,referenceId,description:description??(type==="WITHDRAWAL"?"Withdrawal reserve":"Match stake reserve")});
  return{idempotent:false,transaction,hold};
}
export async function releaseWalletHold(tx:Tx,userId:string,amount:MoneyInput,idempotencyKey:string,type:HoldType,referenceId:string,finalStatus:HoldFinalStatus,description?:string){
  if(!idempotencyKey)throw new Error("IDEMPOTENCY_REQUIRED"); const value=money(amount);
  const existing=await tx.transaction.findUnique({where:{idempotencyKey},include:{wallet:{select:{userId:true}}}}); if(existing){if(existing.wallet.userId!==userId)throw new Error("IDEMPOTENCY_CONFLICT");return{idempotent:true,transaction:existing};}
  const wallet=await lockedWallet(tx,userId);
  let hold=await tx.walletHold.findFirst({where:{walletId:wallet.id,type,referenceId,status:"ACTIVE",amount:value},orderBy:{createdAt:"desc"}});
  if(!hold){
    const sourceType=type==="WITHDRAWAL"?"WITHDRAW":"MATCH_BET";
    const source=await tx.transaction.findFirst({where:{walletId:wallet.id,type:sourceType,referenceId,amount:{lt:0}},orderBy:{createdAt:"desc"}});
    if(source){const legacyKey=`legacy-hold:${type}:${referenceId}:${wallet.id}`; hold=await tx.walletHold.upsert({where:{idempotencyKey:legacyKey},update:{},create:{walletId:wallet.id,type,status:"ACTIVE",amount:value,currency:"USD",referenceType:referenceTypeFor(type),referenceId,idempotencyKey:legacyKey,metadata:{sourceTransactionId:source.id,legacy:true}}});}
  }
  if(!hold)throw new Error("HOLD_NOT_FOUND"); if(wallet.lockedBalance.lt(value))throw new Error("LOCKED_BALANCE_INSUFFICIENT");
  const lockedBefore=wallet.lockedBalance; const lockedAfter=lockedBefore.minus(value).toDecimalPlaces(4);
  await tx.wallet.update({where:{id:wallet.id},data:{lockedBalance:lockedAfter}});
  await tx.walletHold.update({where:{id:hold.id},data:{status:finalStatus,releasedAt:new Date()}});
  const transaction=await appendTransaction(tx,{walletId:wallet.id,type:type==="WITHDRAWAL"?(finalStatus==="RELEASED"?"WITHDRAWAL_RELEASE":"WITHDRAWAL_COMPLETED"):"MATCH_STAKE_RELEASE",amount:new Prisma.Decimal(0),balanceBefore:wallet.balance,balanceAfter:wallet.balance,lockedBalanceBefore:lockedBefore,lockedBalanceAfter:lockedAfter,idempotencyKey,referenceId,description:description??(type==="WITHDRAWAL"?"Withdrawal reserve closed":"Match stake released")});
  return{idempotent:false,transaction,hold};
}
