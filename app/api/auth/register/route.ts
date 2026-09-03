import { NextResponse } from "next/server";
export async function POST() { return NextResponse.json({ error: "Steam is the only supported registration method." }, { status: 410 }); }