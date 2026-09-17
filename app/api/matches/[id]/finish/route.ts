import { NextResponse } from "next/server";

export async function POST(){
  return NextResponse.json(
    {error:"Ручное завершение отключено. Результат матча принимается только от CS2 referee."},
    {status:410}
  );
}
