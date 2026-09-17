import { NextResponse } from "next/server";
export async function POST() { return NextResponse.json({ error: "Steam is the only supported sign-in method." }, { status: 410 }); }