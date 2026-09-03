import { prisma } from "@/lib/prisma";

export const TEST_ACCOUNTS = [
  { key: "1", nickname: "TEST_PLAYER_1", email: "test.player1@duelplay.local", referralCode: "TESTP1", avatarUrl: "/avatars/premium/01-cyan.svg" },
  { key: "2", nickname: "TEST_PLAYER_2", email: "test.player2@duelplay.local", referralCode: "TESTP2", avatarUrl: "/avatars/premium/02-violet.svg" },
] as const;

export async function ensureTestAccounts() {
  const result = [];
  for (const account of TEST_ACCOUNTS) {
    let user = await prisma.user.findUnique({ where: { nickname: account.nickname }, select: { id: true, nickname: true } });
    if (!user) {
      user = await prisma.user.create({
        data: { nickname: account.nickname, email: account.email, avatarUrl: account.avatarUrl, role: "USER", status: "ACTIVE", referralCode: account.referralCode, language: "ru" },
        select: { id: true, nickname: true },
      });
    } else {
      await prisma.user.update({ where: { id: user.id }, data: { email: account.email, avatarUrl: account.avatarUrl, role: "USER", status: "ACTIVE", language: "ru" } });
    }
    await prisma.$executeRawUnsafe('UPDATE "User" SET "isTestAccount" = true WHERE id = $1::uuid', user.id);
    await prisma.wallet.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id, balance: 1000 } });
    result.push(user);
  }
  return result;
}
