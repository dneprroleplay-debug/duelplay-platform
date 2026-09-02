import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/auth";
const prisma = new PrismaClient();
async function main() {
  const game = await prisma.game.upsert({ where: { slug: "cs2" }, update: { isEnabled: true }, create: { slug: "cs2", title: "Counter-Strike 2", isEnabled: true, config: {} } });
  const test = await prisma.user.upsert({ where: { nickname: "TestPlayer" }, update: { email: "test@duelplay.local", passwordHash: hashPassword("Test12345!"), status: "ACTIVE" }, create: { steamId: "TEST_STEAM_ID", nickname: "TestPlayer", email: "test@duelplay.local", passwordHash: hashPassword("Test12345!"), referralCode: "TEST001" } });
  await prisma.wallet.upsert({ where: { userId: test.id }, update: {}, create: { userId: test.id, balance: 100 } });
  const rival = await prisma.user.upsert({ where: { nickname: "RivalPlayer" }, update: { email: "rival@duelplay.local", passwordHash: hashPassword("TestRival12345!"), status: "ACTIVE" }, create: { steamId: "RIVAL_STEAM_ID", nickname: "RivalPlayer", email: "rival@duelplay.local", passwordHash: hashPassword("TestRival12345!"), referralCode: "RIVAL002" } });
  await prisma.wallet.upsert({ where: { userId: rival.id }, update: {}, create: { userId: rival.id, balance: 100 } });
  const adminEmail = process.env.DUELPLAY_ADMIN_EMAIL;
  const adminPassword = process.env.DUELPLAY_ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    await prisma.user.upsert({ where: { nickname: "DuelPlayOwner" }, update: { email: adminEmail.toLowerCase(), passwordHash: hashPassword(adminPassword), role: "SUPERADMIN", status: "ACTIVE" }, create: { nickname: "DuelPlayOwner", email: adminEmail.toLowerCase(), passwordHash: hashPassword(adminPassword), role: "SUPERADMIN", referralCode: "OWNER001" } });
  }
  await prisma.siteSettings.upsert({ where: { key: "standardTheme" }, update: {}, create: { key: "standardTheme", value: { id: "STANDARD" }, description: "Standard interface theme" } });
  await prisma.siteSettings.upsert({ where: { key: "standardAccent" }, update: {}, create: { key: "standardAccent", value: { hex: "#ff2f91" }, description: "Standard interface accent" } });
  console.log(`Seed complete: ${game.title}; test users ready.`);
}
main().catch(e=>{console.error(e);process.exit(1)}).finally(()=>prisma.$disconnect());
