import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { themeById, isThemeId, isThemeBackgroundId, isThemeHeroId } from "@/lib/themes";
import { requireAdmin, audit } from "@/lib/admin";

const allowed = new Set(["standardTheme", "backgroundTheme", "heroBackground"]);

export async function GET(){
  const rows=await prisma.siteSettings.findMany({where:{key:{in:["standardTheme","backgroundTheme","heroBackground"]}}});
  const read=(key:string,fallback:string)=>{
    const row=rows.find(x=>x.key===key);
    return typeof row?.value==="object"&&row.value&&"id" in row.value?String((row.value as {id?:unknown}).id):fallback;
  };
  return NextResponse.json({
    theme:themeById(read("standardTheme","STANDARD")).id,
    accent:themeById(read("standardTheme","STANDARD")).accent,
    background:read("backgroundTheme","stars"),
    heroBackground:read("heroBackground","hero-01")
  });
}

export async function PATCH(r:NextRequest){
  const me=await requireAdmin(5);
  const body=await r.json();
  const key=String(body.key||"");
  const value=String(body.value||"").trim();
  if(!allowed.has(key)||!value) return NextResponse.json({error:"Invalid setting"},{status:400});
  if(key==="standardTheme" && !isThemeId(value)) return NextResponse.json({error:"Invalid theme"},{status:400});
  if(key==="backgroundTheme" && !isThemeBackgroundId(value)) return NextResponse.json({error:"Invalid background"},{status:400});
  if(key==="heroBackground" && !isThemeHeroId(value)) return NextResponse.json({error:"Invalid hero"},{status:400});
  const old=await prisma.siteSettings.findUnique({where:{key}});
  const row=await prisma.siteSettings.upsert({where:{key},update:{value:{id:value},updatedBy:me.id},create:{key,value:{id:value},updatedBy:me.id}});
  await audit(me.id,"CHANGE_SITE_SETTING","SITE_SETTING",row.id,{key,old:old?.value??null,new:value});
  return NextResponse.json({ok:true,key,value});
}
