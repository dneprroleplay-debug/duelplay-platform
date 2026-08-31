import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { themeById } from "@/lib/themes";
export async function GET(){
  const rows=await prisma.siteSettings.findMany({where:{key:{in:["standardTheme","standardAccent"]}}});
  const themeRow=rows.find(x=>x.key==="standardTheme");
  const accentRow=rows.find(x=>x.key==="standardAccent");
  const id=typeof themeRow?.value==="object"&&themeRow?.value&&"id" in themeRow.value?String((themeRow.value as any).id):"STANDARD";
  const accent=typeof accentRow?.value==="object"&&accentRow?.value&&"hex" in accentRow.value?String((accentRow.value as any).hex):themeById(id).accent;
  return NextResponse.json({theme:themeById(id).id,accent});
}
