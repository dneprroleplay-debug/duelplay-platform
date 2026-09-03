import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const accounts = [
  { nickname: 'TEST_PLAYER_1', email: 'test.player1@duelplay.local', referralCode: 'TESTP1', avatarUrl: '/avatars/premium/01-cyan.svg' },
  { nickname: 'TEST_PLAYER_2', email: 'test.player2@duelplay.local', referralCode: 'TESTP2', avatarUrl: '/avatars/premium/02-violet.svg' },
];
try {
  for (const account of accounts) {
    const user = await prisma.user.upsert({
      where: { nickname: account.nickname },
      update: { isTestAccount: true, status: 'ACTIVE', role: 'USER', email: account.email, avatarUrl: account.avatarUrl, language: 'ru' },
      create: { ...account, role: 'USER', status: 'ACTIVE', isTestAccount: true, language: 'ru', wallet: { create: { balance: 1000 } } },
      select: { id: true, nickname: true, isTestAccount: true },
    });
    await prisma.wallet.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id, balance: 1000 } });
    console.log(`${user.nickname}: ${user.id}`);
  }
  console.log('Test accounts are ready. Use /test-login with DUELPLAY_TEST_ACCOUNTS_SECRET.');
} finally { await prisma.$disconnect(); }
