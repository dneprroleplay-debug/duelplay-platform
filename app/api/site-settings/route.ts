import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { themeById } from "@/lib/themes";
export async function GET(){
  const rows=await prisma.siteSettings.findMany({where:{key:{in:["standardTheme","backgroundTheme"]}}});
  const themeRow=rows.find(x=>x.key==="standardTheme"); const bgRow=rows.find(x=>x.key==="backgroundTheme");
  const id=typeof themeRow?.value==="object"&&themeRow?.value&&"id" in themeRow.value?String((themeRow.value as any).id):"STANDARD";
  const background=typeof bgRow?.value==="object"&&bgRow?.value&&"id" in bgRow.value?String((bgRow.value as any).id):"stars";
  return NextResponse.json({theme:themeById(id).id,accent:themeById(id).accent,background});
}
