import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";

export const ADMIN_LEVELS = {
  SUPPORT: 1,
  MODERATOR: 2,
  ADMIN: 3,
  SUPERADMIN: 5,
} as const;
export function adminLevel(role:string){return ADMIN_LEVELS[role as keyof typeof ADMIN_LEVELS]??0}
export async function requireAdmin(minLevel=1){
  const user=await getCurrentUser();
  if(!user || adminLevel(user.role)<minLevel) throw new Error("FORBIDDEN");
  return user;
}
export async function audit(userId:string, action:string, targetType:string, targetId?:string, payload?:unknown){
  return prisma.auditLog.create({data:{userId,action,targetType,targetId:targetId||null,ipAddress:"local",userAgent:"DuelPlay admin",payload:payload as any}});
}
