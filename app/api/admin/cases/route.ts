import { normalizeCaseRarity } from "@/lib/case-rarity";
import {NextRequest,NextResponse} from "next/server";
import {prisma} from "@/lib/prisma";
import {requireAdmin,audit} from "@/lib/admin";
import {assertCaseEconomy} from "@/lib/case-economy";

export async function GET(){
  await requireAdmin(5);
  const cases=await prisma.duelCase.findMany({include:{items:true,_count:{select:{openings:true}}},orderBy:{price:"asc"}});
  return NextResponse.json(cases.map(c=>{const price=Number(c.price);const items=c.items.map(i=>({...i,value:Number(i.value)}));let economy:any=null;try{economy=assertCaseEconomy(price,items)}catch(e){economy={error:e instanceof Error?e.message:"INVALID_CASE"}}return {...c,price,items,economy}}));
}
export async function POST(r:NextRequest){
  const me=await requireAdmin(5); const b=await r.json();
  const slug=String(b.slug||"").trim(),name=String(b.name||"").trim(); const price=Number(b.price);
  if(!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return NextResponse.json({error:"INVALID_CASE_SLUG"},{status:400});
  if(!name || name.length>80) return NextResponse.json({error:"INVALID_CASE_NAME"},{status:400});
  try {
    const rawItems=Array.isArray(b.items)?b.items.map((i:any)=>({name:String(i.name||"").trim(),imageUrl:String(i.imageUrl||"/case-items/common.svg"),rarity:normalizeCaseRarity(i.rarity||"Common"),value:Number(i.value),weight:Math.round(Number(i.weight))})):[];
    assertCaseEconomy(price,rawItems);
    const existing=await prisma.duelCase.findUnique({where:{slug},select:{id:true}});
    if(existing) return NextResponse.json({error:"CASE_SLUG_EXISTS"},{status:409});
    const row=await prisma.duelCase.create({data:{slug,name,description:b.description?String(b.description):null,price,imageUrl:String(b.imageUrl||"/case-items/common.svg"),active:b.active!==false,items:{create:rawItems}} ,include:{items:true}});
    await audit(me.id,"CREATE_CASE","CASE",row.id,{name,price}); return NextResponse.json({...row,price:Number(row.price),items:row.items.map(i=>({...i,value:Number(i.value)}))},{status:201});
  } catch(e) {
    const code=e instanceof Error?e.message:"INVALID_CASE";
    return NextResponse.json({error:code},{status:400});
  }
}
export async function PATCH(r:NextRequest){
  const me=await requireAdmin(5); const b=await r.json(); const id=String(b.id||""); if(!id)return NextResponse.json({error:"id required"},{status:400});
  const old=await prisma.duelCase.findUnique({where:{id},include:{items:true}}); if(!old)return NextResponse.json({error:"Case not found"},{status:404});
  try {
    const data:any={};
    for(const k of ["name","description","imageUrl","active"]){if(b[k]!==undefined)data[k]=k==="active"?Boolean(b[k]):String(b[k]);}
    if(b.price!==undefined){const p=Number(b.price);if(!Number.isFinite(p)||p<=0)return NextResponse.json({error:"INVALID_CASE_PRICE"},{status:400});data.price=p;}
    const nextPrice=b.price!==undefined?Number(b.price):Number(old.price);
    if (b.active !== false) assertCaseEconomy(nextPrice,old.items);
    const row=await prisma.duelCase.update({where:{id},data,include:{items:true}});
    await audit(me.id,"UPDATE_CASE","CASE",id,{old,data}); return NextResponse.json({...row,price:Number(row.price),items:row.items.map(i=>({...i,value:Number(i.value)}))});
  } catch(e) {
    const code=e instanceof Error?e.message:"INVALID_CASE";
    return NextResponse.json({error:code},{status:400});
  }
}

export async function DELETE(r:NextRequest){
  const me=await requireAdmin(5);
  const id=new URL(r.url).searchParams.get("id");
  if(!id)return NextResponse.json({error:"id required"},{status:400});
  const row=await prisma.duelCase.findUnique({where:{id},include:{_count:{select:{openings:true,inventory:true}},items:{select:{id:true}}}});
  if(!row)return NextResponse.json({error:"Case not found"},{status:404});
  if(row._count.openings>0 || row._count.inventory>0)return NextResponse.json({error:"CASE_HAS_HISTORY_OR_INVENTORY"},{status:409});
  await prisma.$transaction(async tx=>{
    await tx.duelCaseItem.deleteMany({where:{caseId:id}});
    await tx.duelCase.delete({where:{id}});
  });
  await audit(me.id,"DELETE_CASE","CASE",id,{name:row.name,slug:row.slug});
  return NextResponse.json({ok:true});
}
