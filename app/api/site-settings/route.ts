import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { themeById } from "@/lib/themes";

export async function GET(){
  const rows=await prisma.siteSettings.findMany({where:{key:{in:["standardTheme","backgroundTheme","heroBackground"]}}});
  const read=(key:string,fallback:string)=>{
    const row=rows.find(x=>x.key===key);
    return typeof row?.value==="object"&&row?.value&&"id" in row.value?String((row.value as {id?:unknown}).id):fallback;
  };
  return NextResponse.json({
    theme:themeById(read("standardTheme","STANDARD")).id,
    accent:themeById(read("standardTheme","STANDARD")).accent,
    background:read("backgroundTheme","stars"),
    heroBackground:read("heroBackground","hero-01")
  });
}
