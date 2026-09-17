import {NextRequest,NextResponse} from "next/server";
import {prisma} from "@/lib/prisma";
import {requireAdmin,audit} from "@/lib/admin";
import {holidayIsActive,holidayWindow,validateHolidayTemplate} from "@/lib/holidays";

function present(x:any,now=new Date()){const active=x.active&&holidayIsActive(x.month,x.day,x.durationDays,now);const w=holidayWindow(now.getUTCFullYear(),x.month,x.day,x.durationDays);return {...x,isActive:active,startsAt:w.startsAt,endsAt:w.endsAt};}
function err(e:unknown){const c=e instanceof Error?e.message:"UNKNOWN";const m:any={INVALID_SLUG:"Invalid holiday slug",INVALID_NAME:"Invalid holiday name/theme",INVALID_DATE:"Invalid holiday date",INVALID_DURATION:"Invalid duration",INVALID_MULTIPLIER:"Invalid multiplier",PREMIUM_REQUIRES_PASS:"Premium pass requires event pass"};return NextResponse.json({error:m[c]||"Holiday operation failed"},{status:400});}
export async function GET(r:NextRequest){try{const admin=new URL(r.url).searchParams.get("admin")==="1";if(admin)await requireAdmin(5);const now=new Date();const rows=await prisma.holidayTemplate.findMany({where:admin?{}:{active:true},orderBy:[{month:"asc"},{day:"asc"}]});return NextResponse.json(rows.map(x=>present(x,now)));}catch(e){return err(e);}}
export async function POST(r:NextRequest){try{const me=await requireAdmin(5);const b=await r.json().catch(()=>({}));
  if(String(b.action||"")==="instantiate"){
    const templateId=String(b.templateId||""); const year=Number(b.year);
    if(!templateId||!Number.isInteger(year)||year<2024||year>2100)return NextResponse.json({error:"Invalid template/year"},{status:400});
    const row=await prisma.$transaction(async tx=>{
      const t=await tx.holidayTemplate.findUnique({where:{id:templateId}}); if(!t||!t.active)throw new Error("NOT_FOUND");
      const w=holidayWindow(year,t.month,t.day,t.durationDays);
      const existing=await tx.event.findFirst({where:{name:t.name,startsAt:w.startsAt,endsAt:w.endsAt}});
      if(existing)return existing;
      return tx.event.create({data:{name:t.name,icon:t.icon,theme:t.theme,startsAt:w.startsAt,endsAt:w.endsAt,effects:t.effects === null ? undefined : t.effects,missions:t.missions === null ? undefined : t.missions,rewards:t.rewards === null ? undefined : t.rewards,caseId:t.caseId,eventPass:t.eventPass,premiumPass:t.premiumPass,premiumPrice:t.premiumPass?19.99:0,promoMultiplier:t.promoMultiplier,status:"SCHEDULED"}});
    },{isolationLevel:"Serializable"});
    await audit(me.id,"INSTANTIATE_HOLIDAY","EVENT",row.id,{templateId,year,name:row.name});
    return NextResponse.json(present(row),{status:201});
  }
  const v=validateHolidayTemplate(b);const row=await prisma.holidayTemplate.create({data:v as any});await audit(me.id,"CREATE_HOLIDAY_TEMPLATE","HOLIDAY_TEMPLATE",row.id,{slug:row.slug});return NextResponse.json(present(row),{status:201});
}catch(e){if(e instanceof Error&&e.message==="NOT_FOUND")return NextResponse.json({error:"Holiday template not found or disabled"},{status:404});return err(e);}}
export async function PATCH(r:NextRequest){try{const me=await requireAdmin(5);const b=await r.json().catch(()=>({}));const id=String(b.id||"");if(!id)return NextResponse.json({error:"id required"},{status:400});const old=await prisma.holidayTemplate.findUnique({where:{id}});if(!old)return NextResponse.json({error:"Holiday template not found"},{status:404});const v=validateHolidayTemplate({...old,...b});const row=await prisma.holidayTemplate.update({where:{id},data:v as any});await audit(me.id,"UPDATE_HOLIDAY_TEMPLATE","HOLIDAY_TEMPLATE",id,{slug:row.slug});return NextResponse.json(present(row));}catch(e){return err(e);}}
export async function DELETE(r:NextRequest){try{const me=await requireAdmin(5);const id=new URL(r.url).searchParams.get("id")||"";if(!id)return NextResponse.json({error:"id required"},{status:400});const old=await prisma.holidayTemplate.findUnique({where:{id}});if(!old)return NextResponse.json({error:"Holiday template not found"},{status:404});await prisma.holidayTemplate.update({where:{id},data:{active:false}});await audit(me.id,"DISABLE_HOLIDAY_TEMPLATE","HOLIDAY_TEMPLATE",id,{slug:old.slug});return NextResponse.json({ok:true});}catch(e){return err(e);}}
