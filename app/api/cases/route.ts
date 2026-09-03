import {NextRequest,NextResponse} from "next/server";
import {randomInt} from "node:crypto";
import {prisma} from "@/lib/prisma";
import {getCurrentUser} from "@/lib/current-user";

const DEFAULT_CASES:Array<{slug:string;name:string;description:string;price:number;imageUrl:string;items:Array<[string,string,string,number,number]>}>=[
 {slug:"starter",name:"Starter Case",description:"Быстрый шанс получить первый предмет DuelPlay.",price:1,imageUrl:"/images/maps/mirage.jpg",
  items:[
   ["Pistol Core","/case-items/common.svg","Common",0.50,50],["Emerald Fang","/case-items/uncommon.svg","Uncommon",1.20,28],
   ["Azure Strike","/case-items/rare.svg","Rare",2.50,14],["Violet Pulse","/case-items/epic.svg","Epic",5,6],["Gold Reaper","/case-items/legendary.svg","Legendary",12,2]
 ]},
 {slug:"neon",name:"Neon Duel Case",description:"Неоновый кейс с редкими наградами.",price:3,imageUrl:"/images/maps/ancient.jpg",
  items:[
   ["Emerald Fang","/case-items/uncommon.svg","Uncommon",1.50,42],["Azure Strike","/case-items/rare.svg","Rare",3.50,30],
   ["Violet Pulse","/case-items/epic.svg","Epic",7,18],["Gold Reaper","/case-items/legendary.svg","Legendary",15,8],["Neon Wolf","/case-items/mythic.svg","Mythic",30,2]
 ]},
 {slug:"premium",name:"Premium Arsenal",description:"Премиальный кейс для охотников за редкими предметами.",price:10,imageUrl:"/images/maps/nuke.jpg",
  items:[
   ["Azure Strike","/case-items/rare.svg","Rare",5,35],["Violet Pulse","/case-items/epic.svg","Epic",12,35],
   ["Gold Reaper","/case-items/legendary.svg","Legendary",28,25],["Neon Wolf","/case-items/mythic.svg","Mythic",80,5]
 ]}
];

async function ensureCases(){
 for(const c of DEFAULT_CASES){
  const existing=await prisma.duelCase.findUnique({where:{slug:c.slug},include:{items:true}});
  if(!existing){
   await prisma.duelCase.create({data:{slug:c.slug,name:c.name,description:c.description,price:c.price,imageUrl:c.imageUrl,items:{create:c.items.map(x=>({name:x[0],imageUrl:x[1],rarity:x[2],value:x[3],weight:x[4]}))}}});
  }else if(existing.imageUrl!==c.imageUrl){
   await prisma.duelCase.update({where:{id:existing.id},data:{imageUrl:c.imageUrl,description:c.description}});
  }
 }
 return prisma.duelCase.findMany({where:{active:true},include:{items:{orderBy:{value:"asc"}}},orderBy:{price:"asc"}});
}

export async function GET(){
 try{
  const cases=await ensureCases();
  return NextResponse.json(cases.map(c=>({...c,price:Number(c.price),items:c.items.map(i=>({...i,value:Number(i.value)}))})));
 }catch(e){console.error(e);return NextResponse.json({error:"Не удалось загрузить кейсы"},{status:500})}
}

export async function POST(request:NextRequest){
 try{
  const user=await getCurrentUser(); if(!user)return NextResponse.json({error:"Войдите в аккаунт",errorCode:"AUTH_REQUIRED"},{status:401});
  const body=await request.json(); const slug=String(body.slug||"");
  const cases=await ensureCases(); const box=cases.find(c=>c.slug===slug&&c.active);
  if(!box)return NextResponse.json({error:"Кейс не найден"},{status:404});
  const price=Number(box.price);
  const total=box.items.reduce((s,i)=>s+Math.max(0,i.weight),0);
  if(total<=0)return NextResponse.json({error:"В кейсе нет предметов"},{status:409});
  const roll=randomInt(1,total+1); let cursor=0; let won=box.items[0];
  for(const item of box.items){cursor+=Math.max(0,item.weight);if(roll<=cursor){won=item;break;}}
  const result=await prisma.$transaction(async tx=>{
    const wallet=await tx.wallet.findUnique({where:{userId:user.id}});
    if(!wallet||Number(wallet.balance)<price)throw new Error("INSUFFICIENT_BALANCE");
    const before=Number(wallet.balance),after=Number((before-price).toFixed(4));
    await tx.wallet.update({where:{id:wallet.id},data:{balance:after}});
    await tx.transaction.create({data:{walletId:wallet.id,type:"CASE_OPEN",status:"COMPLETED",amount:-price,balanceBefore:before,balanceAfter:after,description:`Открытие кейса · ${box.name}`}});
    const inventory=await tx.inventoryItem.create({data:{userId:user.id,caseId:box.id,caseItemId:won.id,name:won.name,imageUrl:won.imageUrl,rarity:won.rarity,value:won.value,status:"AVAILABLE"}});
    return {inventory,balance:after};
  });
  return NextResponse.json({ok:true,item:{...result.inventory,value:Number(result.inventory.value)},balance:result.balance});
 }catch(e){
  if(e instanceof Error&&e.message==="INSUFFICIENT_BALANCE")return NextResponse.json({error:"Недостаточно средств. Пополните кошелёк.",errorCode:"INSUFFICIENT_BALANCE"},{status:400});
  console.error(e);return NextResponse.json({error:"Не удалось открыть кейс"},{status:500});
 }
}
