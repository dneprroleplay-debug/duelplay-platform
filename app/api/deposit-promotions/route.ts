import { getFeatureFlag } from "@/lib/feature-flags";
import {NextRequest,NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {requireAdmin,audit} from '@/lib/admin';

function validate(b:any){
 const name=String(b.name||'Deposit Bonus').trim().slice(0,120);
 const type=String(b.type||'PERCENT').toUpperCase();
 const multiplier=Number(b.multiplier??2),maxBonus=Number(b.maxBonus??50),wagering=Number(b.wagering??0),expiresHours=Number(b.expiresHours??168);
 if(!name||!['PERCENT','FIXED'].includes(type))throw new Error('INVALID_PROMOTION');
 if(!Number.isFinite(multiplier)||multiplier<1||multiplier>100)return null;
 if(!Number.isFinite(maxBonus)||maxBonus<0||maxBonus>100000)return null;
 if(!Number.isFinite(wagering)||wagering<0||wagering>1000000)return null;
 if(!Number.isInteger(expiresHours)||expiresHours<0||expiresHours>8760)return null;
 const restrictions=b.restrictions&&typeof b.restrictions==='object'?b.restrictions:null;
 return {name,type,multiplier,maxBonus,wagering,expiresHours,withdrawable:Boolean(b.withdrawable),restrictions,active:b.active!==false};
}

export async function GET(){
  if (!(await getFeatureFlag("PROMOS", false))) return NextResponse.json({ error: "Promotions are temporarily disabled", errorCode: "FEATURE_DISABLED" }, { status: 503 });return NextResponse.json(await prisma.depositPromotion.findMany({orderBy:{createdAt:'desc'}}))}
export async function POST(r:NextRequest){
  if (!(await getFeatureFlag("PROMOS", false))) return NextResponse.json({ error: "Promotions are temporarily disabled", errorCode: "FEATURE_DISABLED" }, { status: 503 });const me=await requireAdmin(5);try{const data=validate(await r.json());if(!data)return NextResponse.json({error:'Invalid promotion values'},{status:400});const row=await prisma.depositPromotion.create({data});await audit(me.id,'CREATE_DEPOSIT_PROMOTION','DEPOSIT_PROMOTION',row.id,{name:row.name,type:row.type,multiplier:row.multiplier,maxBonus:Number(row.maxBonus),wagering:Number(row.wagering),active:row.active});return NextResponse.json(row,{status:201})}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Invalid promotion'},{status:400})}}
