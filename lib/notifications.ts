import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
export const notificationTypes = ["SYSTEM","MATCH_FOUND","MATCH_READY","MATCH_STARTED","PLAYER_CONNECTED","WIN","LOSS","TECHNICAL_WIN","REFUND","CANCELLATION","DEPOSIT","WITHDRAWAL","REFERRAL","CREATOR","BONUS","TOURNAMENT","PROMOTION","EVENT","TRANSACTION_SUCCESS","TRANSACTION_FAILED","DISPUTE_UPDATE","PROMO_ACTIVATED","ACHIEVEMENT_UNLOCKED","SECURITY_ALERT","CHALLENGE","CHALLENGE_ACCEPTED","CHALLENGE_DECLINED"] as const;

export type NotificationTypeName = (typeof notificationTypes)[number];
export async function notify(tx:Prisma.TransactionClient,userId:string,type:NotificationTypeName,title:string,body:string,payload?:Prisma.InputJsonValue){return tx.notification.create({data:{userId,type,status:"UNREAD",title,body,payload:payload??{}}});}
export async function notifyUser(userId:string,type:NotificationTypeName,title:string,body:string,payload?:Prisma.InputJsonValue){return prisma.notification.create({data:{userId,type,status:"UNREAD",title,body,payload:payload??{}}});}
