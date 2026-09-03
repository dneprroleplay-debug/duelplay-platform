import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';

const prisma = new PrismaClient();
const steamId = process.argv[2]?.trim() || process.env.BOOTSTRAP_STEAM_ID?.trim();

if (!steamId || !/^\d{17}$/.test(steamId)) {
  console.error('Usage: node scripts/reset-test-users.mjs <17-digit SteamID>');
  console.error('Or set BOOTSTRAP_STEAM_ID in .env');
  process.exitCode = 1;
} else {
  try {
    const apiKey = process.env.STEAM_API_KEY?.trim();
    let nickname = `Steam_${steamId.slice(-8)}`;
    let avatarUrl = null;

    if (apiKey) {
      try {
        const response = await fetch(
          `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${encodeURIComponent(apiKey)}&steamids=${steamId}`,
          { cache: 'no-store' },
        );
        if (response.ok) {
          const data = await response.json();
          const player = data?.response?.players?.[0];
          if (player?.personaname) {
            const cleaned = String(player.personaname).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20);
            nickname = cleaned.length >= 3 ? cleaned : nickname;
          }
          avatarUrl = player?.avatarfull || null;
        }
      } catch (error) {
        console.warn('Steam profile lookup failed; using fallback nickname.', error?.message || error);
      }
    }

    // This is a deliberate TEST-DB reset. CASCADE removes dependent test data
    // that references users (sessions, wallets, matches, disputes, etc.).
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" RESTART IDENTITY CASCADE');

    const referralCode = `DP${randomBytes(6).toString('hex').toUpperCase()}`;
    const user = await prisma.user.create({
      data: {
        steamId,
        nickname,
        avatarUrl,
        steamAvatarUrl: avatarUrl,
        role: 'SUPERADMIN',
        status: 'ACTIVE',
        referralCode,
        language: 'ru',
        wallet: { create: {} },
      },
      select: { id: true, steamId: true, nickname: true, role: true, status: true },
    });

    console.log('DuelPlay test database reset complete.');
    console.log(JSON.stringify(user, null, 2));
    console.log('All previous test users and their dependent data were removed.');
  } catch (error) {
    console.error('Reset failed:', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
